# AI Product Recommendation System

A small React app that displays a product catalog and uses the Groq API to recommend products from that catalog based on a user's preference.

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create `.env` from `.env.example` and add your API key:

   ```bash
   GROQ_API_KEY=your_groq_api_key_here
   GROQ_MODEL=llama-3.1-8b-instant
   PORT=3001
   ```

3. Run the app:

   ```bash
   npm run dev
   ```

The React app runs on Vite, and `/api/recommend` is proxied to the local Express server.

## How It Works

- `src/products.js` contains the catalog used by both the frontend and backend.
- `server/index.js` sends the user's preference and product list to Groq.
- The API asks for JSON, validates that returned product IDs exist in the catalog, and sends the matched products back to React.
- If the Groq key is missing or rate-limited, the server falls back to a local catalog matcher so the demo still works.
