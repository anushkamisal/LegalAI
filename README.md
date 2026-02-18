# Legal AI Chatbot

A full-stack AI-powered document analysis and Q&A system designed for legal documents. Upload PDF files and ask questions about their content with AI-generated answers backed by document citations.

## Features

- **PDF Upload & Processing**: Upload legal documents that are automatically processed and indexed
- **Vector Search**: FAISS-based vector database for semantic search across documents
- **AI Q&A**: GPT-4 powered question answering with contextual awareness
- **Citation Tracking**: Answers include relevant citations with page numbers and snippets from source documents
- **Interactive UI**: Modern React frontend with PDF viewer and chat interface
- **Multi-Document Support**: Process and manage multiple legal documents with separate vector indices

## Tech Stack

### Backend
- **Framework**: FastAPI
- **AI/ML**:
  - LangChain & LangChain-OpenAI for LLM integration
  - LangGraph for workflow orchestration
  - OpenAI GPT-4o-mini for text generation
- **Vector Database**: FAISS for semantic search
- **Data Processing**:
  - PyPDF for PDF parsing
  - Recursive character text splitting for chunking
- **Server**: Uvicorn

### Frontend
- **Framework**: React 18.3
- **Build Tool**: Vite 7.3
- **PDF Viewing**: pdfjs-dist

## Project Structure

```
legal_index/
├── backend/
│   ├── main.py              # FastAPI application with all endpoints
│   ├── requirements.txt      # Python dependencies
│   ├── uploads/             # Uploaded PDF files
│   ├── legal_index/         # FAISS vector indices (one per document)
│   └── __pycache__/
├── frontend/
│   ├── src/
│   │   ├── App.jsx          # Main app component
│   │   ├── components/
│   │   │   ├── ChatPanel.jsx        # Chat interface
│   │   │   ├── PDFViewer.jsx        # PDF display
│   │   │   └── UploadScreen.jsx     # File upload
│   │   ├── App.css
│   │   ├── index.css
│   │   └── main.jsx
│   ├── public/              # Static assets
│   ├── package.json
│   ├── vite.config.js
│   └── index.html
└── README.md
```

## Installation & Setup

### Prerequisites
- Python 3.11+
- Node.js 18+
- OpenAI API key

### Backend Setup

1. Navigate to the backend directory:
```bash
cd backend
```

2. Install Python dependencies:
```bash
pip install -r requirements.txt
```

3. Create a `.env` file in the backend directory with your OpenAI API key:
```env
OPENAI_API_KEY=your_api_key_here
```

4. Start the backend server:
```bash
uvicorn main:app --reload --port 8000
```

The API will be available at `http://localhost:8000`

### Frontend Setup

1. Navigate to the frontend directory:
```bash
cd frontend
```

2. Install dependencies:
```bash
npm install
```

3. Start the development server:
```bash
npm run dev
```

The app will be available at `http://localhost:5173`

## API Endpoints

- **POST `/upload-pdf/`** - Upload a PDF file for indexing
  - Returns: `file_id`, `filename`, `pages`, `chunks`

- **POST `/query/`** - Submit a question about the uploaded document
  - Body: `{ "query": "What is the main clause?" }`
  - Returns: `answer`, `query_type`, `citations`

- **GET `/current-pdf/`** - Get information about the currently loaded PDF

- **GET `/pdf/{file_id}.pdf`** - Download or view a specific PDF

## How It Works

1. **Upload**: User uploads a legal PDF through the React frontend
2. **Processing**: Backend loads PDF, splits into chunks, and generates embeddings
3. **Indexing**: Embeddings are stored in FAISS for fast semantic search
4. **Query**: User asks a question via the chat interface
5. **Retrieval**: LangGraph workflow retrieves relevant document chunks
6. **Generation**: GPT-4o-mini generates an answer with citations
7. **Display**: Answer and citations are shown in the chat interface

## Configuration

### CORS Settings
The backend is configured to accept requests from:
- `http://localhost:5173` (Vite dev server)
- `http://localhost:5175` (alternative port)

### Model Configuration
- **LLM Model**: GPT-4o-mini
- **Temperature**: 0 (deterministic responses)
- **Embeddings**: OpenAI Embeddings

## Development

### Backend Development
- Main logic is in [backend/main.py](backend/main.py)
- FastAPI automatically generates interactive API docs at `/docs`
- Modify CORS origins in `main.py` if needed

### Frontend Development
- React components in [frontend/src/components/](frontend/src/components/)
- Styling in [frontend/src/App.css](frontend/src/App.css)
- API base URL configured in [frontend/src/App.jsx](frontend/src/App.jsx#L7)

## File Structure Details

### Backend Files
- **uploads/**: Contains user-uploaded PDF files
- **legal_index/**: Contains subdirectories with FAISS indices, one per document (named by UUID)

### Frontend Components
- **ChatPanel.jsx**: Handles user queries and displays chat messages
- **PDFViewer.jsx**: Displays PDF with annotation capabilities
- **UploadScreen.jsx**: File upload interface

## Error Handling

- CORS errors: Check that frontend URL is in the backend's allowed origins
- API Connection: Verify backend is running on port 8000
- OpenAI Errors: Confirm API key is valid and has available credits
- PDF Processing: Supported formats are standard PDF files


## Notes

- Ensure your OpenAI API key is set in the `.env` file before running
- Each uploaded document gets its own FAISS index stored separately
- The system supports concurrent document management through separate indices
- All PDF files are stored server-side; downloads via the API preserve this
