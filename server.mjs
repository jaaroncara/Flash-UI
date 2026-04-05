import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import { GoogleGenAI, Type } from '@google/genai';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Initialize GoogleGenAI SDK in backend
const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
    console.warn("WARNING: GEMINI_API_KEY is not set in the environment.");
}
const ai = new GoogleGenAI({ apiKey });

// 1. POST /api/styles
// Generates 3 initial creative style concepts based on the prompt.
app.post('/api/styles', async (req, res) => {
    try {
        const { fullPrompt } = req.body;
        
        const stylePrompt = `
Generate 3 distinct, minimalist design directions for an interactive visual component: "${fullPrompt}".

**FOCUS:**
Interactive charts, data visualizations, complex diagrams, or specialized UX/UI designs.

**STRICT IP SAFEGUARD:**
Never use artist or brand names. Use technical, structural, and data-driven metaphors.

**CREATIVE EXAMPLES (Use as a guide for tone):**
- Example A: "Monochrome Vector Precision" (Sharp lines, high contrast, technical drafting aesthetic, focus on data density).
- Example B: "Kinetic Data Topology" (Fluid transitions, interconnected nodes, elevation-based depth, focus on relationship mapping).
- Example C: "Minimalist Brutalist Interface" (Heavy borders, monospace typography, raw layout, focus on functional clarity).
- Example D: "Atmospheric Glass Projection" (Subtle blurs, light-based hierarchy, translucent layers, focus on immersive data).

**GOAL:**
Return ONLY a raw JSON array of 3 *NEW*, creative names for these directions (e.g. ["Vector Precision Grid", "Kinetic Node Topology", "Brutalist Data Matrix"]).
        `.trim();

        const styleResponse = await ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: stylePrompt
        });

        let generatedStyles = [];
        const styleText = styleResponse.text || '[]';
        const jsonMatch = styleText.match(/\[[\s\S]*\]/);
        
        if (jsonMatch) {
            try {
                generatedStyles = JSON.parse(jsonMatch[0]);
            } catch (e) {
                console.warn("Failed to parse styles, using fallbacks");
            }
        }

        if (!generatedStyles || generatedStyles.length < 3) {
            generatedStyles = [
                "Vector Precision Grid",
                "Kinetic Node Topology",
                "Brutalist Data Matrix"
            ];
        }
        
        res.json({ styles: generatedStyles.slice(0, 3) });
    } catch (e) {
        console.error("Error generating styles:", e);
        res.status(500).json({ error: e.message });
    }
});

// 2. POST /api/artifact
// Takes the prompt + style requirement, sends a streaming request to @google/genai, and streams HTML chunks directly back.
app.post('/api/artifact', async (req, res) => {
    const { fullPrompt, styleInstruction } = req.body;

    // Set headers for Server-Sent Events (SSE) / streaming
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Transfer-Encoding', 'chunked');

    try {
        const prompt = `
You are Flash UI, an elite designer and developer. Create a stunning, interactive, and minimalist visual component for: "${fullPrompt}".

**CONCEPTUAL DIRECTION: ${styleInstruction}**

**COMPONENT TYPE:**
Focus on interactive charts, data visualizations, complex diagrams, or specialized UX/UI designs.

**VISUAL EXECUTION RULES:**
1. **Minimalism**: Eliminate all non-essential elements. Use whitespace as a structural tool.
2. **Interactivity**: The component MUST be interactive. Use standard Web APIs (Canvas, SVG) or lightweight logic for hover states, clicks, and data transitions.
3. **Typography**: Use high-quality system fonts or Google Fonts. Pair a clean sans-serif with a technical monospace for data values.
4. **IP SAFEGUARD**: No artist names, trademarks, or copyrighted brands.
5. **Layout**: Use sharp edges, visible grids, and clear hierarchy. Avoid generic "modern" cards.
6. **Data**: Use realistic, evocative mock data that fits the prompt.

**TECHNICAL REQUIREMENTS:**
- Use Tailwind CSS for styling.
- Use D3.js or Recharts if complex charting is required (assume they are available via CDN if needed, but prefer standard SVG/Canvas for performance).
- Ensure the code is self-contained and high-performance.

Return ONLY RAW HTML. No markdown fences.
        `.trim();

        const responseStream = await ai.models.generateContentStream({
            model: 'gemini-3-flash-preview',
            contents: prompt,
        });

        for await (const chunk of responseStream) {
            const text = chunk.text;
            if (typeof text === 'string') {
                res.write(text);
            }
        }
        res.end();
    } catch (e) {
        console.error('Error generating artifact stream:', e);
        res.write(`\n\n<div style="color: #ff6b6b; padding: 20px;">Error: ${e.message}</div>`);
        res.end();
    }
});

// 3. POST /api/refine
// Sends the single-shot refinement request from the Drawer to the model and returns JSON.
app.post('/api/refine', async (req, res) => {
    try {
        const { html, userRefinement } = req.body;

        const prompt = `
You are a master UI/UX designer. Your task is to surgically refine an existing UI component based on a specific user request.

**CRITICAL INSTRUCTION:**
Keep the new version as close as possible to the original. Maintain the layout, color palette, and overall "vibe" unless the user explicitly asks to change them. Only modify the specific elements or properties mentioned in the request.

**ORIGINAL COMPONENT HTML:**
${html}

**USER REFINEMENT REQUEST:**
"${userRefinement}"

**OUTPUT:**
Return a single, improved version of the component in JSON format.
{ "name": "Refined Version", "html": "..." }
        `.trim();

        const response = await ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: prompt,
            config: { 
                temperature: 0.7, 
                responseMimeType: 'application/json',
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        name: { type: Type.STRING },
                        html: { type: Type.STRING }
                    },
                    required: ['name', 'html']
                }
            }
        });

        const text = response.text;
        if (text) {
            try {
                const variation = JSON.parse(text);
                res.json(variation);
            } catch (e) {
                console.error("Failed to parse refinement JSON", e);
                res.status(500).json({ error: "Failed to parse JSON response from model" });
            }
        } else {
            res.status(500).json({ error: "Empty response from model" });
        }
    } catch (e) {
        console.error("Error refining variation:", e);
        res.status(500).json({ error: e.message });
    }
});

// For production (Docker container), serve the static frontend files
app.use(express.static(path.join(__dirname, 'dist')));

// Fallback to index.html for React Router / SPA
app.get(/^.*$/, (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
