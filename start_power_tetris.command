#!/bin/bash

# Navigate to the script's directory
cd "$(dirname "$0")"

echo "---------------------------------------------------"
echo "  ⚡️ Starting PowerTetris..."
echo "---------------------------------------------------"

# 1. Kill invalid/old processes to ensure clean ports
echo "Cleaning up old processes..."
lsof -ti:3001 | xargs kill -9 2>/dev/null
lsof -ti:5173 | xargs kill -9 2>/dev/null
lsof -ti:5174 | xargs kill -9 2>/dev/null
lsof -ti:5175 | xargs kill -9 2>/dev/null
lsof -ti:5176 | xargs kill -9 2>/dev/null

# 2. Go into app directory
cd power-tetris-app

# 3. Start Server in background
echo "Starting Backend API (Port 3001)..."
cd server
npm start &
SERVER_PID=$!
cd ..

# 4. Start Frontend in background
echo "Starting Frontend (Vite)..."
npm run dev -- --port 5173 &
FRONTEND_PID=$!

# Wait for servers to initialize
echo "Waiting for servers to launch..."
sleep 4

# 5. Open Browser
echo "Opening PowerTetris in browser..."
open http://localhost:5173

echo "---------------------------------------------------"
echo "  ✅ App is running!"
echo "  Close this window to stop the servers."
echo "---------------------------------------------------"

# Keep the script running to keep child processes alive
wait $SERVER_PID $FRONTEND_PID
