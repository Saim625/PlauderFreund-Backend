# PlauderFreund Backend

PlauderFreund is a **voice-based AI companion for elderly users**.  
This repository contains the **backend** for Milestone 1 (MVP).

## 🚀 Tech Stack

- Node.js + Express
- Socket.IO (real-time audio communication)
- Winston (logging)
- Dotenv (environment variables)
- Nodemon (dev dependency for auto-restart in development)

## 📦 Installed Packages

- **express** – Web server
- **socket.io** – Real-time audio communication
- **winston** – Logging system
- **dotenv** – Load environment variables
- **nodemon** – Development tool (auto restarts server)

## ⚙️ Environment Variables

Create a `.env` file inside the PlauderFreund-BE folder with the following keys (placeholders for now):

OPENAI_API_KEY=your-openai-key
ELEVENLABS_API_KEY=your-elevenlabs-key
GOOGLE_API_KEY=your-google-key
PORT=3000

## 🖥️ Getting Started

1. Clone the repo:

   ```bash
    git remote add origin git@github.com:Saim625/PlauderFreund-Backend.git
   ```

Install dependencies: npm install

Run in development mode: npm run dev

Server will start at: http://localhost:3000
