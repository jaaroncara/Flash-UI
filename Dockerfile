# Stage 1: Build the React application
FROM node:20-alpine AS build

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy source code and build
COPY . .
RUN npm run build

# Stage 2: Serve the application using Node.js
FROM node:20-alpine

WORKDIR /app

# Copy backend server, package.json
COPY server.mjs package.json ./
# Copy built frontend assets
COPY --from=build /app/dist ./dist

# Install production dependencies only (express, cors, dotenv, @google/genai)
RUN npm install --omit=dev

# Expose Node.js port (configured in server.mjs to use PORT env var or 3001)
EXPOSE 3001

# Start the Express server
CMD ["node", "server.mjs"]
