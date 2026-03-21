/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

//Vibe coded by Joe with the invaluable assistance of Gemini, and a touch of caffeine.

import { GoogleGenAI, Type } from '@google/genai';
import React, { useState, useCallback, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom/client';

import { Artifact, Session, ComponentVariation, LayoutOption } from './types';
import { generateId } from './utils';

import NetworkGraphBackground from './components/NetworkGraphBackground';
import ArtifactCard from './components/ArtifactCard';
import SideDrawer from './components/SideDrawer';
import { 
    ThinkingIcon, 
    CodeIcon, 
    SparklesIcon, 
    ArrowLeftIcon, 
    ArrowRightIcon, 
    ArrowUpIcon, 
    GridIcon,
    PaperclipIcon,
    XIcon,
    DownloadIcon
} from './components/Icons';
import * as pdfjs from 'pdfjs-dist';
// @ts-ignore - Vite handles this import
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;

function App() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentSessionIndex, setCurrentSessionIndex] = useState<number>(-1);
  const [focusedArtifactIndex, setFocusedArtifactIndex] = useState<number | null>(null);
  
  const [inputValue, setInputValue] = useState<string>('');
  const [refinementValue, setRefinementValue] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isRefining, setIsRefining] = useState<boolean>(false);
  
  const [drawerState, setDrawerState] = useState<{
      isOpen: boolean;
      mode: 'code' | 'variations' | null;
      title: string;
      data: any; 
  }>({ isOpen: false, mode: null, title: '', data: null });

  const [componentVariations, setComponentVariations] = useState<ComponentVariation[]>([]);

  const [fileContent, setFileContent] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState<boolean>(false);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const gridScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
      inputRef.current?.focus();
  }, []);

  // Fix for mobile: reset scroll when focusing an item to prevent "overscroll" state
  useEffect(() => {
    if (focusedArtifactIndex !== null && window.innerWidth <= 1024) {
      if (gridScrollRef.current) {
        gridScrollRef.current.scrollTop = 0;
      }
      window.scrollTo(0, 0);
    }
  }, [focusedArtifactIndex]);

  const handleInputChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputValue(event.target.value);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setFileName(file.name);
    
    try {
        if (file.type === 'application/pdf') {
            const arrayBuffer = await file.arrayBuffer();
            try {
                const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
                let text = '';
                for (let i = 1; i <= pdf.numPages; i++) {
                    const page = await pdf.getPage(i);
                    const content = await page.getTextContent();
                    text += content.items.map((item: any) => item.str).join(' ') + '\n';
                }
                setFileContent(text);
            } catch (pdfError: any) {
                console.error("PDF parsing failed:", pdfError);
                setFileName(null);
                setFileContent(null);
            }
        } else {
            const reader = new FileReader();
            reader.onload = (event) => {
                setFileContent(event.target?.result as string);
            };
            reader.readAsText(file);
        }
    } catch (error) {
        console.error("Error reading file:", error);
        setFileName(null);
        setFileContent(null);
    } finally {
        setIsUploading(false);
    }
  };

  const removeFile = () => {
    setFileName(null);
    setFileContent(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const parseJsonStream = async function* (responseStream: AsyncGenerator<{ text: string }>) {
      let buffer = '';
      for await (const chunk of responseStream) {
          const text = chunk.text;
          if (typeof text !== 'string') continue;
          buffer += text;
          let braceCount = 0;
          let start = buffer.indexOf('{');
          while (start !== -1) {
              braceCount = 0;
              let end = -1;
              for (let i = start; i < buffer.length; i++) {
                  if (buffer[i] === '{') braceCount++;
                  else if (buffer[i] === '}') braceCount--;
                  if (braceCount === 0 && i > start) {
                      end = i;
                      break;
                  }
              }
              if (end !== -1) {
                  const jsonString = buffer.substring(start, end + 1);
                  try {
                      yield JSON.parse(jsonString);
                      buffer = buffer.substring(end + 1);
                      start = buffer.indexOf('{');
                  } catch (e) {
                      start = buffer.indexOf('{', start + 1);
                  }
              } else {
                  break; 
              }
          }
      }
  };

  const handleOpenRefinement = useCallback(() => {
    if (drawerState.isOpen && drawerState.mode === 'variations') {
        setDrawerState(s => ({...s, isOpen: false}));
        return;
    }
    const currentSession = sessions[currentSessionIndex];
    if (!currentSession || focusedArtifactIndex === null) return;
    const currentArtifact = currentSession.artifacts[focusedArtifactIndex];

    setComponentVariations([]);
    setRefinementValue('');
    setDrawerState({ isOpen: true, mode: 'variations', title: 'Refine Artifact', data: currentArtifact.id });
  }, [sessions, currentSessionIndex, focusedArtifactIndex, drawerState.isOpen, drawerState.mode]);

  const handleRefine = useCallback(async () => {
    const currentSession = sessions[currentSessionIndex];
    if (!currentSession || focusedArtifactIndex === null || !refinementValue.trim()) return;
    const currentArtifact = currentSession.artifacts[focusedArtifactIndex];

    setIsRefining(true);
    const userRefinement = refinementValue.trim();
    setRefinementValue('');

    try {
        const apiKey = process.env.API_KEY;
        if (!apiKey) throw new Error("API_KEY is not configured.");
        const ai = new GoogleGenAI({ apiKey });

        const prompt = `
You are a master UI/UX designer. Your task is to surgically refine an existing UI component based on a specific user request.

**CRITICAL INSTRUCTION:**
Keep the new version as close as possible to the original. Maintain the layout, color palette, and overall "vibe" unless the user explicitly asks to change them. Only modify the specific elements or properties mentioned in the request.

**ORIGINAL COMPONENT HTML:**
${currentArtifact.html}

**USER REFINEMENT REQUEST:**
"${userRefinement}"

**OUTPUT:**
Return a single, improved version of the component in JSON format.
{ "name": "Refined Version", "html": "..." }
        `.trim();

        const response = await ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: [{ parts: [{ text: prompt }], role: 'user' }],
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
                if (variation.name && variation.html) {
                    setComponentVariations(prev => [variation, ...prev]);
                }
            } catch (e) {
                console.error("Failed to parse refinement JSON", e);
            }
        }
    } catch (e: any) {
        console.error("Error refining variation:", e);
    } finally {
        setIsRefining(false);
    }
  }, [sessions, currentSessionIndex, focusedArtifactIndex, refinementValue]);

  const applyVariation = (html: string) => {
      if (focusedArtifactIndex === null) return;
      setSessions(prev => prev.map((sess, i) => 
          i === currentSessionIndex ? {
              ...sess,
              artifacts: sess.artifacts.map((art, j) => 
                j === focusedArtifactIndex ? { ...art, html, status: 'complete' } : art
              )
          } : sess
      ));
      setDrawerState(s => ({ ...s, isOpen: false }));
  };

  const handleShowCode = () => {
      if (drawerState.isOpen && drawerState.mode === 'code') {
          setDrawerState(s => ({...s, isOpen: false}));
          return;
      }
      const currentSession = sessions[currentSessionIndex];
      if (currentSession && focusedArtifactIndex !== null) {
          const artifact = currentSession.artifacts[focusedArtifactIndex];
          setDrawerState({ isOpen: true, mode: 'code', title: 'Source Code', data: artifact.html });
      }
  };

  const handleDownloadSource = () => {
    const currentSession = sessions[currentSessionIndex];
    if (currentSession && focusedArtifactIndex !== null) {
        const artifact = currentSession.artifacts[focusedArtifactIndex];
        const blob = new Blob([artifact.html], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${artifact.styleName.replace(/\s+/g, '_').toLowerCase()}.html`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
  };

  const handleSendMessage = useCallback(async (manualPrompt?: string) => {
    const promptToUse = manualPrompt || inputValue;
    const trimmedInput = promptToUse.trim();
    
    if (!trimmedInput || isLoading) return;
    if (!manualPrompt) setInputValue('');

    setIsLoading(true);
    const baseTime = Date.now();
    const sessionId = generateId();

    // Include file context if available
    const fullPrompt = fileContent 
        ? `${trimmedInput}\n\nADDITIONAL CONTEXT FROM UPLOADED FILE (${fileName}):\n${fileContent}`
        : trimmedInput;

    const placeholderArtifacts: Artifact[] = Array(3).fill(null).map((_, i) => ({
        id: `${sessionId}_${i}`,
        styleName: 'Designing...',
        html: '',
        status: 'streaming',
    }));

    const newSession: Session = {
        id: sessionId,
        prompt: trimmedInput,
        timestamp: baseTime,
        artifacts: placeholderArtifacts
    };

    setSessions(prev => [...prev, newSession]);
    setCurrentSessionIndex(sessions.length); 
    setFocusedArtifactIndex(null); 
    
    // Clear file after sending
    const currentFileContent = fileContent;
    const currentFileName = fileName;
    removeFile();

    try {
        const apiKey = process.env.API_KEY;
        if (!apiKey) throw new Error("API_KEY is not configured.");
        const ai = new GoogleGenAI({ apiKey });

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
            contents: { role: 'user', parts: [{ text: stylePrompt }] }
        });

        let generatedStyles: string[] = [];
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
        
        generatedStyles = generatedStyles.slice(0, 3);

        setSessions(prev => prev.map(s => {
            if (s.id !== sessionId) return s;
            return {
                ...s,
                artifacts: s.artifacts.map((art, i) => ({
                    ...art,
                    styleName: generatedStyles[i]
                }))
            };
        }));

        const generateArtifact = async (artifact: Artifact, styleInstruction: string) => {
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
                    contents: [{ parts: [{ text: prompt }], role: "user" }],
                });

                let accumulatedHtml = '';
                for await (const chunk of responseStream) {
                    const text = chunk.text;
                    if (typeof text === 'string') {
                        accumulatedHtml += text;
                        setSessions(prev => prev.map(sess => 
                            sess.id === sessionId ? {
                                ...sess,
                                artifacts: sess.artifacts.map(art => 
                                    art.id === artifact.id ? { ...art, html: accumulatedHtml } : art
                                )
                            } : sess
                        ));
                    }
                }
                
                let finalHtml = accumulatedHtml.trim();
                if (finalHtml.startsWith('```html')) finalHtml = finalHtml.substring(7).trimStart();
                if (finalHtml.startsWith('```')) finalHtml = finalHtml.substring(3).trimStart();
                if (finalHtml.endsWith('```')) finalHtml = finalHtml.substring(0, finalHtml.length - 3).trimEnd();

                setSessions(prev => prev.map(sess => 
                    sess.id === sessionId ? {
                        ...sess,
                        artifacts: sess.artifacts.map(art => 
                            art.id === artifact.id ? { ...art, html: finalHtml, status: finalHtml ? 'complete' : 'error' } : art
                        )
                    } : sess
                ));

            } catch (e: any) {
                console.error('Error generating artifact:', e);
                setSessions(prev => prev.map(sess => 
                    sess.id === sessionId ? {
                        ...sess,
                        artifacts: sess.artifacts.map(art => 
                            art.id === artifact.id ? { ...art, html: `<div style="color: #ff6b6b; padding: 20px;">Error: ${e.message}</div>`, status: 'error' } : art
                        )
                    } : sess
                ));
            }
        };

        await Promise.all(placeholderArtifacts.map((art, i) => generateArtifact(art, generatedStyles[i])));

    } catch (e) {
        console.error("Fatal error in generation process", e);
    } finally {
        setIsLoading(false);
        setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [inputValue, isLoading, sessions.length]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && !isLoading) {
      event.preventDefault();
      handleSendMessage();
    }
  };

  const nextItem = useCallback(() => {
      if (focusedArtifactIndex !== null) {
          if (focusedArtifactIndex < 2) setFocusedArtifactIndex(focusedArtifactIndex + 1);
      } else {
          if (currentSessionIndex < sessions.length - 1) setCurrentSessionIndex(currentSessionIndex + 1);
      }
  }, [currentSessionIndex, sessions.length, focusedArtifactIndex]);

  const prevItem = useCallback(() => {
      if (focusedArtifactIndex !== null) {
          if (focusedArtifactIndex > 0) setFocusedArtifactIndex(focusedArtifactIndex - 1);
      } else {
           if (currentSessionIndex > 0) setCurrentSessionIndex(currentSessionIndex - 1);
      }
  }, [currentSessionIndex, focusedArtifactIndex]);

  const isLoadingDrawer = isLoading && drawerState.mode === 'variations' && componentVariations.length === 0;

  const hasStarted = sessions.length > 0 || isLoading;
  const currentSession = sessions[currentSessionIndex];

  let canGoBack = false;
  let canGoForward = false;

  if (hasStarted) {
      if (focusedArtifactIndex !== null) {
          canGoBack = focusedArtifactIndex > 0;
          canGoForward = focusedArtifactIndex < (currentSession?.artifacts.length || 0) - 1;
      } else {
          canGoBack = currentSessionIndex > 0;
          canGoForward = currentSessionIndex < sessions.length - 1;
      }
  }

  return (
    <>
        <a href="https://github.com/jaaroncara" target="_blank" rel="noreferrer" className={`creator-credit ${hasStarted ? 'hide-on-mobile' : ''}`}>
            created by @joeaaroncara
        </a>

        <SideDrawer 
            isOpen={drawerState.isOpen} 
            onClose={() => setDrawerState(s => ({...s, isOpen: false}))} 
            title={drawerState.title}
        >
            {isLoadingDrawer && (
                 <div className="loading-state">
                     <ThinkingIcon /> 
                     Designing variations...
                 </div>
            )}

            {drawerState.mode === 'code' && (
                <div className="code-drawer-content">
                    <button className="download-code-btn" onClick={handleDownloadSource}>
                        <DownloadIcon /> Download Source
                    </button>
                    <pre className="code-block"><code>{drawerState.data}</code></pre>
                </div>
            )}
            
            {drawerState.mode === 'variations' && (
                <div className="variations-container">
                    <div className="refinement-input-box">
                        <textarea 
                            placeholder="Refine this artifact..." 
                            value={refinementValue}
                            onChange={(e) => setRefinementValue(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.shiftKey && !isRefining) {
                                    e.preventDefault();
                                    handleRefine();
                                }
                            }}
                            disabled={isRefining}
                            rows={1}
                        />
                        <button onClick={handleRefine} disabled={isRefining || !refinementValue.trim()}>
                            {isRefining ? <ThinkingIcon /> : <ArrowUpIcon />}
                        </button>
                    </div>

                    <div className="sexy-grid">
                        {componentVariations.map((v, i) => (
                             <div key={i} className="sexy-card" onClick={() => applyVariation(v.html)}>
                                 <div className="sexy-preview">
                                     <iframe srcDoc={v.html} title={v.name} sandbox="allow-scripts allow-same-origin" />
                                 </div>
                                 <div className="sexy-label">{v.name}</div>
                             </div>
                        ))}
                    </div>
                </div>
            )}
        </SideDrawer>

        {canGoBack && (
            <button className="nav-handle left" onClick={prevItem} aria-label="Previous">
                <ArrowLeftIcon />
            </button>
        )}
        {canGoForward && (
            <button className="nav-handle right" onClick={nextItem} aria-label="Next">
                <ArrowRightIcon />
            </button>
        )}

        <div className={`action-bar ${focusedArtifactIndex !== null ? 'visible' : ''}`}>
             <div className="action-buttons">
                <button onClick={() => setFocusedArtifactIndex(null)}>
                    <GridIcon /> Grid View
                </button>
                <button onClick={() => {
                    setFocusedArtifactIndex(null);
                    setTimeout(() => inputRef.current?.focus(), 100);
                }}>
                    <ArrowUpIcon /> New Prompt
                </button>
                <button onClick={handleOpenRefinement} disabled={isLoading}>
                    <SparklesIcon /> Refine
                </button>
                <button onClick={handleShowCode}>
                    <CodeIcon /> Code
                </button>
                <button onClick={handleDownloadSource}>
                    <DownloadIcon /> Download
                </button>
             </div>
        </div>

        <div className={`floating-input-container ${focusedArtifactIndex !== null ? 'hidden' : ''}`}>
            <div className={`input-wrapper ${isLoading ? 'loading' : ''}`}>
                {!isLoading ? (
                    <>
                        <textarea 
                            ref={inputRef}
                            value={inputValue} 
                            placeholder="Describe your UI or visualization..."
                            onChange={handleInputChange} 
                            onKeyDown={handleKeyDown} 
                            disabled={isLoading} 
                        />
                        <div className="input-controls">
                            <div className="left-controls">
                                <input 
                                    type="file" 
                                    ref={fileInputRef} 
                                    onChange={handleFileUpload} 
                                    accept=".csv,.txt,.pdf" 
                                    style={{ display: 'none' }} 
                                />
                                {!fileName ? (
                                    <button 
                                        className="file-upload-btn" 
                                        onClick={() => fileInputRef.current?.click()}
                                        disabled={isUploading}
                                    >
                                        <PaperclipIcon /> {isUploading ? 'Reading...' : 'Add Context (.csv, .txt, .pdf)'}
                                    </button>
                                ) : (
                                    <div className="file-indicator">
                                        <PaperclipIcon />
                                        <span>{fileName}</span>
                                        <button onClick={removeFile}><XIcon /></button>
                                    </div>
                                )}
                            </div>
                            <button className="send-button" onClick={() => handleSendMessage()} disabled={isLoading || !inputValue.trim()}>
                                <ArrowUpIcon />
                            </button>
                        </div>
                    </>
                ) : (
                    <div className="input-generating-label">
                        <span className="generating-prompt-text">{currentSession?.prompt}</span>
                        <ThinkingIcon />
                    </div>
                )}
            </div>
        </div>

        <div className="immersive-app">
            <NetworkGraphBackground />

            <div className={`stage-container ${focusedArtifactIndex !== null ? 'mode-focus' : 'mode-split'} ${drawerState.isOpen ? 'drawer-open' : ''}`}>
                 <div className={`empty-state ${hasStarted ? 'fade-out' : ''}`}>
                     <div className="empty-content">
                         <h1>Flash UI</h1>
                         <p>Interactive Data & Info Visualization Builder</p>
                     </div>
                 </div>

                {sessions.map((session, sIndex) => {
                    let positionClass = 'hidden';
                    if (sIndex === currentSessionIndex) positionClass = 'active-session';
                    else if (sIndex < currentSessionIndex) positionClass = 'past-session';
                    else if (sIndex > currentSessionIndex) positionClass = 'future-session';
                    
                    return (
                        <div key={session.id} className={`session-group ${positionClass}`}>
                            <div className="artifact-grid" ref={sIndex === currentSessionIndex ? gridScrollRef : null}>
                                {session.artifacts.map((artifact, aIndex) => {
                                    const isFocused = focusedArtifactIndex === aIndex;
                                    
                                    return (
                                        <ArtifactCard 
                                            key={artifact.id}
                                            artifact={artifact}
                                            isFocused={isFocused}
                                            onClick={() => setFocusedArtifactIndex(aIndex)}
                                        />
                                    );
                                })}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    </>
  );
}

const rootElement = document.getElementById('root');
if (rootElement) {
  const root = ReactDOM.createRoot(rootElement);
  root.render(<React.StrictMode><App /></React.StrictMode>);
}