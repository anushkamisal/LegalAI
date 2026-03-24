from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware #enables cross-origin requests.
from fastapi.responses import JSONResponse, FileResponse #response classes
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import List, Optional, Dict
import os
import shutil
from pathlib import Path
import uuid

from langchain_community.document_loaders import PyPDFLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_community.vectorstores import FAISS
from langchain_openai import OpenAIEmbeddings, ChatOpenAI
from langgraph.graph import StateGraph, END
from typing_extensions import TypedDict
from dotenv import load_dotenv
import json
import re
from collections import defaultdict

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Load environment variables
load_dotenv()

app = FastAPI(title="Legal AI Chatbot API")

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:5175"
    ],  # React frontend
    allow_credentials=True, #This allows cookies, authorization headers, or sessions to be sent.
    allow_methods=["*"],#Access-Control-Allow-Methods: GET, POST, PUT, DELETE, ...
    allow_headers=["*"],#Allows all request headers
)
# as backend and frontend have different origins, the browser blocks requests unless the backend explicitly allows them.

# Global variables
UPLOAD_DIR = Path("uploads") #Stores uploaded PDFs (or other files)
INDEX_DIR = Path("legal_index") #Stores vector indexes FAISS
UPLOAD_DIR.mkdir(exist_ok=True)
INDEX_DIR.mkdir(exist_ok=True)

current_pdf_path = None
current_pdf_filename = None
vectorstore = None
llm = None
pdf_documents = []  # Store original documents with metadata
legal_ai_graph = None  # LangGraph compiled workflow


# State definition for LangGraph
class GraphState(TypedDict):
    query: str
    query_type: str
    context: str
    citations: List[Dict]
    answer: str


class QueryRequest(BaseModel):
    query: str


class Citation(BaseModel):
    id: str
    page: int
    snippet: str
    full_text: str
    relevance_score: float


class QueryResponse(BaseModel):
    answer: str
    query_type: str
    citations: List[Citation]


class UploadResponse(BaseModel):
    message: str
    filename: str
    file_id: str
    pages: int
    chunks: int

#pydantic models 

def initialize_llm():
    """Initialize the LLM"""
    global llm
    if llm is None:
        llm = ChatOpenAI(model="gpt-4o-mini", temperature=0)
    return llm


def classify_query_node(state: GraphState) -> GraphState:
    """Classify the query into SUMMARY, CHRONOLOGY, or FACT"""
    query = state["query"]
    llm_instance = initialize_llm()
    
    prompt = f"""
    Classify the following legal query into one category:
    - SUMMARY (for requests like "summarize", "overview", "main points")
    - CHRONOLOGY (for requests about timeline, sequence of events, dates)
    - FACT (for specific questions about details, names, decisions, etc.)

    Query: {query}
    Return only the category name.
    """
    
    response = llm_instance.invoke(prompt)
    query_type = response.content.strip().upper()
    
    return {
        **state,
        "query_type": query_type
    }


def extract_key_phrases(text: str) -> List[str]:
    """Extract key phrases from text for highlighting"""
    # Remove common words and extract meaningful phrases
    words = re.findall(r'\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b|\b\w{4,}\b', text)
    # Get unique meaningful words/phrases (longer than 3 chars)
    phrases = list(set([w for w in words if len(w) > 3]))[:10]
    return phrases


def retrieve_context_node(state: GraphState) -> GraphState:
    """Retrieve relevant context from vector store with similarity scores"""
    query = state["query"]
    
    if vectorstore is None:
        raise HTTPException(status_code=400, detail="No PDF has been uploaded yet")
    
    # Get documents with scores
    docs_with_scores = vectorstore.similarity_search_with_score(query, k=6)
    
    # Extract context and metadata
    context_parts = []
    citations = []
    
    for i, (doc, score) in enumerate(docs_with_scores):
        context_parts.append(doc.page_content)
        
        # Create citation with page number and snippet
        page_num = doc.metadata.get('page', 0) + 1  # Convert to 1-indexed
        
        # Extract key phrases for highlighting
        key_phrases = extract_key_phrases(doc.page_content[:500])
        
        citations.append({
            "id": str(uuid.uuid4()),
            "page": page_num,
            "snippet": doc.page_content[:200] + "..." if len(doc.page_content) > 200 else doc.page_content,
            "full_text": doc.page_content,
            "relevance_score": float(1 / (1 + score))  # Convert distance to similarity score
        })
    
    context = "\n\n".join(context_parts)
    
    return {
        **state,
        "context": context,
        "citations": citations
    }


def summary_node(state: GraphState) -> GraphState:
    """Generate summary answer"""
    query = state["query"]
    context = state["context"]
    llm_instance = initialize_llm()
    
    prompt = f"""
    Provide a concise legal summary of the judgment using ONLY the context provided.
    Include specific references to sections, paragraphs, or key points.
    Structure your answer clearly with main findings.

    Context:
    {context}

    Question:
    {query}
    
    Provide a well-structured answer with clear references to the source material.
    """
    
    response = llm_instance.invoke(prompt)
    
    return {
        **state,
        "answer": response.content
    }


def chronology_node(state: GraphState) -> GraphState:
    """Generate chronology answer"""
    query = state["query"]
    context = state["context"]
    llm_instance = initialize_llm()
    
    prompt = f"""
    Extract the chronological sequence of events from the judgment
    using ONLY the context. Present in a clear timeline format.

    Context:
    {context}

    Question:
    {query}
    
    List events in chronological order with dates where available.
    Use bullet points or numbered list for clarity.
    """
    
    response = llm_instance.invoke(prompt)
    
    return {
        **state,
        "answer": response.content
    }


def fact_node(state: GraphState) -> GraphState:
    """Generate fact-based answer"""
    query = state["query"]
    context = state["context"]
    llm_instance = initialize_llm()
    
    prompt = f"""
    Extract the factual answer for the query using ONLY the context provided.
    Be precise and cite specific information from the document.

    Context:
    {context}

    Question:
    {query}
    
    Provide a direct, factual answer with specific references.
    If the answer is not in the context, state that clearly.
    """
    
    response = llm_instance.invoke(prompt)
    
    return {
        **state,
        "answer": response.content
    }


def route_query(state: GraphState) -> str:
    """Route to appropriate answer node based on query type"""
    query_type = state["query_type"]
    
    if query_type == "SUMMARY":
        return "summary_node"
    elif query_type == "CHRONOLOGY":
        return "chronology_node"
    else:
        return "fact_node"


def build_legal_ai_graph() -> StateGraph:
    """Build and compile the LangGraph workflow"""
    # Create the graph
    workflow = StateGraph(GraphState)
    
    # Add nodes
    workflow.add_node("classify_query", classify_query_node)
    workflow.add_node("retrieve_context", retrieve_context_node)
    workflow.add_node("summary_node", summary_node)
    workflow.add_node("chronology_node", chronology_node)
    workflow.add_node("fact_node", fact_node)
    
    # Set entry point
    workflow.set_entry_point("classify_query")
    
    # Add edges
    workflow.add_edge("classify_query", "retrieve_context")
    
    # Add conditional edges based on query type
    workflow.add_conditional_edges(
        "retrieve_context",
        route_query,
        {
            "summary_node": "summary_node",
            "chronology_node": "chronology_node",
            "fact_node": "fact_node"
        }
    )
    
    # All answer nodes end the workflow
    workflow.add_edge("summary_node", END)
    workflow.add_edge("chronology_node", END)
    workflow.add_edge("fact_node", END)
    
    # Compile the graph
    return workflow.compile()


@app.post("/upload-pdf/", response_model=UploadResponse)
async def upload_pdf(file: UploadFile = File(...)):
    """Upload and process a PDF file"""
    global current_pdf_path, current_pdf_filename, vectorstore, pdf_documents, legal_ai_graph
    
    if not file.filename.endswith('.pdf'):
        raise HTTPException(status_code=400, detail="Only PDF files are allowed")
    
    # Generate unique file ID
    file_id = str(uuid.uuid4())
    file_extension = Path(file.filename).suffix
    unique_filename = f"{file_id}{file_extension}"
    
    # Save uploaded file
    file_path = UPLOAD_DIR / unique_filename
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
    
    current_pdf_path = str(file_path)
    current_pdf_filename = file.filename
    
    try:
        # Load and process PDF
        loader = PyPDFLoader(str(file_path))
        docs = loader.load()
        pdf_documents = docs  # Store for later reference
        
        # Split into chunks
        splitter = RecursiveCharacterTextSplitter(
            chunk_size=1000,
            chunk_overlap=200
        )
        #chunk overlap: 
        chunks = splitter.split_documents(docs)
        
        # Create embeddings and vector store
        embeddings = OpenAIEmbeddings()
        vectorstore = FAISS.from_documents(chunks, embeddings)
        
        # Save vector store
        index_path = INDEX_DIR / file_id
        index_path.mkdir(exist_ok=True)
        vectorstore.save_local(str(index_path))
        
        # Build LangGraph workflow
        legal_ai_graph = build_legal_ai_graph()
        
        return UploadResponse(
            message="PDF uploaded and processed successfully",
            filename=file.filename,
            file_id=file_id,
            pages=len(docs),
            chunks=len(chunks)
        )
    
    except Exception as e:
        # Clean up on error
        if file_path.exists():
            file_path.unlink()
        raise HTTPException(status_code=500, detail=f"Error processing PDF: {str(e)}")


@app.post("/query/", response_model=QueryResponse)
async def process_query(request: QueryRequest):
    """Process a legal query and return answer with citations using LangGraph"""
    
    if vectorstore is None:
        raise HTTPException(status_code=400, detail="Please upload a PDF first")
    
    if legal_ai_graph is None:
        raise HTTPException(status_code=500, detail="Legal AI workflow not initialized")
    
    try:
        # Create initial state
        initial_state: GraphState = {
            "query": request.query,
            "query_type": "",
            "context": "",
            "citations": [],
            "answer": ""
        }
        
        # Run the LangGraph workflow
        result = legal_ai_graph.invoke(initial_state)
        
        # Convert citations to Citation objects for response
        citations = [
            Citation(
                id=c["id"],
                page=c["page"],
                snippet=c["snippet"],
                full_text=c["full_text"],
                relevance_score=c["relevance_score"]
            )
            for c in result["citations"]
        ]
        
        return QueryResponse(
            answer=result["answer"],
            query_type=result["query_type"],
            citations=citations
        )
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error processing query: {str(e)}")


@app.get("/pdf/{filename}")
async def get_pdf(filename: str):
    """Serve the uploaded PDF file"""
    file_path = UPLOAD_DIR / filename
    
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="PDF not found")
    
    return FileResponse(
        file_path, 
        media_type='application/pdf',
        headers={"Content-Disposition": f"inline; filename={filename}"}
    )

#api endpoints 
@app.get("/current-pdf/")
async def get_current_pdf():
    """Get information about the currently loaded PDF"""
    if current_pdf_path is None:
        return {"loaded": False}
    
    file_id = Path(current_pdf_path).stem
    
    return {
        "loaded": True,
        "filename": current_pdf_filename,
        "file_id": file_id,
        "path": f"/pdf/{Path(current_pdf_path).name}"
    }


@app.get("/health/")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "pdf_loaded": current_pdf_path is not None,
        "openai_configured": os.getenv("OPENAI_API_KEY") is not None
    }


@app.delete("/clear/")
async def clear_session():
    """Clear current session and uploaded files"""
    global current_pdf_path, current_pdf_filename, vectorstore, pdf_documents, legal_ai_graph
    
    current_pdf_path = None
    current_pdf_filename = None
    vectorstore = None
    pdf_documents = []
    legal_ai_graph = None
    
    return {"message": "Session cleared successfully"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=True)


