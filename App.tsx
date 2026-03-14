import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { GeneratedImage } from './types';
import { extractStyleJson, generateSwappedImage, editGeneratedImage } from './services/gemini';
import { Icons } from './constants';
import { storage } from './services/storage';

const MAX_HISTORY = 12; 
const MAX_LIBRARY = 12; 
const MAX_REFERENCES = 5;

const resizeImage = (base64Str: string, maxWidth = 1024, maxHeight = 1024): Promise<string> => {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      console.warn("[App] Image resize timed out, using original");
      resolve(base64Str);
    }, 10000);

    const img = new Image();
    img.src = base64Str;
    img.onload = () => {
      clearTimeout(timeout);
      const canvas = document.createElement('canvas');
      let width = img.width;
      let height = img.height;
      
      const ratio = Math.min(maxWidth / width, maxHeight / height, 1);
      width *= ratio;
      height *= ratio;

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, width, height);
      }
      resolve(canvas.toDataURL('image/jpeg', 0.7)); 
    };
    img.onerror = () => {
      clearTimeout(timeout);
      resolve(base64Str);
    };
  });
};

const App: React.FC = () => {
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3>(1);
  const [direction, setDirection] = useState(0);
  const [isPromptGenerationTimeout, setIsPromptGenerationTimeout] = useState(false);
  const [view, setView] = useState<'home' | 'results' | 'styles' | 'profile'>('home');
  const [inspiration, setInspiration] = useState<string | null>(null);
  const [extractedJson, setExtractedJson] = useState<string>('');
  const [isExtracting, setIsExtracting] = useState(false);
  const analysisIdRef = useRef(0);
  const [myReferences, setMyReferences] = useState<string[]>([]);
  const [isSavingRefs, setIsSavingRefs] = useState(false);
  const [isProcessingRefs, setIsProcessingRefs] = useState(false);
  const [isProcessingInspiration, setIsProcessingInspiration] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [history, setHistory] = useState<GeneratedImage[]>([]);
  const [stylesLibrary, setStylesLibrary] = useState<string[]>([]);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editPrompt, setEditPrompt] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  
  const [timer, setTimer] = useState(0);
  const [statusMsg, setStatusMsg] = useState('');

  const [showCamera, setShowCamera] = useState(false);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const STORAGE_KEY = 'style_rep_vault_v5';
  const LIBRARY_KEY = 'style_rep_library_v2';
  const REFS_KEY = 'style_rep_refs_v1';
  const INSPIRATION_KEY = 'style_rep_inspiration_v1';
  const ANALYSIS_KEY = 'style_rep_analysis_v1';
  const STEP_KEY = 'style_rep_step_v1';

  const [isLoaded, setIsLoaded] = useState(false);
  const [resultsTab, setResultsTab] = useState<'latest' | 'history'>('latest');

  // Swipe Navigation Logic
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);

  const navigationSequence = [
    { view: 'home', step: 1, tab: 'latest' },
    { view: 'home', step: 2, tab: 'latest' },
    { view: 'results', step: 2, tab: 'latest' },
    { view: 'results', step: 2, tab: 'history' },
    { view: 'styles', step: 2, tab: 'latest' },
    { view: 'profile', step: 2, tab: 'latest' },
  ] as const;

  const getCurrentIndex = () => {
    if (view === 'home') return currentStep === 1 ? 0 : 1;
    if (view === 'results') return resultsTab === 'latest' ? 2 : 3;
    if (view === 'styles') return 4;
    if (view === 'profile') return 5;
    return 0;
  };

  const navigateToIndex = (index: number) => {
    if (index < 0 || index >= navigationSequence.length) return;
    const target = navigationSequence[index];
    const currentIndex = getCurrentIndex();
    
    // Set animation direction
    setDirection(index > currentIndex ? 1 : -1);
    
    if (target.view === 'home') {
      setCurrentStep(target.step as 1 | 2);
    }
    if (target.view === 'results') {
      setResultsTab(target.tab as 'latest' | 'history');
    }
    setView(target.view);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null || touchStartY.current === null) return;
    
    const deltaX = e.changedTouches[0].clientX - touchStartX.current;
    const deltaY = e.changedTouches[0].clientY - touchStartY.current;
    
    // Detect horizontal swipe: dominant X movement and at least 50px
    if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 60) {
      const currentIndex = getCurrentIndex();
      if (deltaX < 0) { // Swipe Left -> Next
        navigateToIndex(currentIndex + 1);
      } else { // Swipe Right -> Prev
        navigateToIndex(currentIndex - 1);
      }
    }
    
    touchStartX.current = null;
    touchStartY.current = null;
  };

  useEffect(() => {
    console.log("[App] Component mounted");
    return () => console.log("[App] Component unmounted");
  }, []);

  // Load initial data from IndexedDB
  useEffect(() => {
    const loadData = async () => {
      try {
        const savedHistory = await storage.getItem<GeneratedImage[]>(STORAGE_KEY);
        if (savedHistory) setHistory(savedHistory.slice(0, MAX_HISTORY));
        
        const savedLibrary = await storage.getItem<string[]>(LIBRARY_KEY);
        if (savedLibrary) setStylesLibrary(savedLibrary.slice(0, MAX_LIBRARY));

        const savedRefs = await storage.getItem<string[]>(REFS_KEY);
        if (savedRefs) setMyReferences(savedRefs.slice(0, MAX_REFERENCES));

        const savedInspiration = await storage.getItem<string>(INSPIRATION_KEY);
        if (savedInspiration) setInspiration(savedInspiration);

        const savedAnalysis = await storage.getItem<string>(ANALYSIS_KEY);
        if (savedAnalysis) setExtractedJson(savedAnalysis);

        const savedStep = await storage.getItem<number>(STEP_KEY);
        if (savedStep === 1 || savedStep === 2) setCurrentStep(savedStep as 1 | 2);
      } catch (e) {
        console.error("Failed to load initial data from IndexedDB", e);
      } finally {
        setIsLoaded(true);
      }
    };
    loadData();
  }, []);

  // Persist data to IndexedDB
  useEffect(() => {
    if (isLoaded) {
      storage.setItem(STORAGE_KEY, history);
    }
  }, [history, isLoaded]);

  useEffect(() => {
    if (isLoaded) {
      storage.setItem(LIBRARY_KEY, stylesLibrary);
    }
  }, [stylesLibrary, isLoaded]);

  useEffect(() => {
    const saveRefs = async () => {
      if (isLoaded) {
        setIsSavingRefs(true);
        try {
          await storage.setItem(REFS_KEY, myReferences);
        } catch (err) {
          console.error("Failed to save references to IndexedDB", err);
        } finally {
          setIsSavingRefs(false);
        }
      }
    };
    saveRefs();
  }, [myReferences, isLoaded]);

  useEffect(() => {
    if (isLoaded) {
      if (inspiration) {
        storage.setItem(INSPIRATION_KEY, inspiration);
      } else {
        storage.removeItem(INSPIRATION_KEY);
      }
    }
  }, [inspiration, isLoaded]);

  useEffect(() => {
    if (isLoaded) {
      storage.setItem(ANALYSIS_KEY, extractedJson);
    }
  }, [extractedJson, isLoaded]);

  useEffect(() => {
    if (isLoaded) {
      storage.setItem(STEP_KEY, currentStep);
    }
  }, [currentStep, isLoaded]);

  useEffect(() => {
    let interval: number;
    if (isExtracting || isGenerating || isEditing) {
      interval = window.setInterval(() => {
        setTimer(prev => prev + 1);
      }, 1000);
    } else {
      setTimer(0);
    }
    return () => clearInterval(interval);
  }, [isExtracting, isGenerating, isEditing]);

  useEffect(() => {
    if (isExtracting) {
      const msgs = ["Scanning fabrics...", "Analyzing pose geometry...", "Detecting lighting profile...", "Deconstructing aesthetic..."];
      setStatusMsg(msgs[Math.floor(timer / 3) % msgs.length]);
    } else if (isGenerating || isEditing) {
      const msgs = ["Mapping facial features...", "Adapting body structure...", "Applying environment textures...", "Final color grading...", "Polishing shadows..."];
      setStatusMsg(msgs[Math.floor(timer / 4) % msgs.length]);
    }
  }, [timer, isExtracting, isGenerating, isEditing]);

  useEffect(() => {
    if (isLoaded && inspiration && !extractedJson && !isExtracting && !genError && !isProcessingInspiration) {
      console.log("[App] Auto-triggering analysis for inspiration");
      runStyleAnalysis(inspiration);
    }
  }, [inspiration, extractedJson, isExtracting, genError, isLoaded, isProcessingInspiration]);

  useEffect(() => {
    let stream: MediaStream | null = null;
    if (showCamera && videoRef.current) {
      navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: facingMode, width: { ideal: 1024 }, height: { ideal: 1024 } }, 
        audio: false 
      })
      .then(s => {
        stream = s;
        if (videoRef.current) videoRef.current.srcObject = s;
      })
      .catch(err => {
        console.error("Camera error:", err);
        setShowCamera(false);
      });
    }
    return () => {
      if (stream) stream.getTracks().forEach(track => track.stop());
    };
  }, [showCamera, facingMode]);

  const runStyleAnalysis = async (image: string) => {
    const id = ++analysisIdRef.current;
    console.log(`[App] Starting style analysis #${id}...`);
    setIsExtracting(true);
    setGenError(null);
    setIsPromptGenerationTimeout(false);

    // 25s Timeout for the entire analysis process
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("TIMEOUT")), 25000);
    });

    try {
      console.log(`[App][#${id}] Optimizing image for analysis...`);
      const analysisImage = await resizeImage(image, 768, 768); 
      console.log(`[App][#${id}] Extracting style JSON...`);
      
      const json = await Promise.race([
        extractStyleJson(analysisImage),
        timeoutPromise
      ]);
      
      if (id === analysisIdRef.current) {
        console.log(`[App][#${id}] Analysis successful, updating state.`);
        setExtractedJson(json);
      }
    } catch (err: any) {
      if (id === analysisIdRef.current) {
        console.error(`[App][#${id}] JSON Extraction failed`, err);
        if (err.message === "TIMEOUT") {
          setIsPromptGenerationTimeout(true);
          setGenError("Analysis timed out (25s). Please try again.");
        } else {
          setGenError(err.message || "Analysis Failed: Could not extract style data from this image.");
        }
      }
    } finally {
      if (id === analysisIdRef.current) {
        setIsExtracting(false);
      }
    }
  };

  const handleInspirationUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    console.log("[App] handleInspirationUpload triggered", file ? `File: ${file.name} (${file.size} bytes)` : "No file");
    
    if (file) {
      setIsProcessingInspiration(true);
      const reader = new FileReader();
      reader.onload = async (ev) => {
        try {
          console.log("[App] FileReader loaded image");
          const raw = ev.target?.result as string;
          console.log("[App] Resizing image...");
          const optimized = await resizeImage(raw);
          console.log("[App] Image optimized, size:", Math.round(optimized.length / 1024), "KB");
          
          setInspiration(optimized);
          setExtractedJson(''); 
          setGenError(null);
          runStyleAnalysis(optimized);
          
          setStylesLibrary(prev => {
            const updated = [optimized, ...prev.filter(p => p !== optimized)].slice(0, MAX_LIBRARY);
            return updated;
          });
        } catch (err) {
          console.error("[App] Upload process failed", err);
          setGenError("Image optimization failed.");
        } finally {
          setIsProcessingInspiration(false);
          // Reset input value so the same file can be selected again
          e.target.value = '';
        }
      };
      reader.onerror = (err) => {
        console.error("[App] FileReader error", err);
        setGenError("Failed to read the image file.");
        setIsProcessingInspiration(false);
      };
      reader.readAsDataURL(file);
    }
  };

  const applyLibraryStyle = (styleImg: string) => {
    setInspiration(styleImg);
    setExtractedJson('');
    setGenError(null);
    runStyleAnalysis(styleImg);
    setView('home');
  };

  const deleteFromLibrary = (idx: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setStylesLibrary(prev => prev.filter((_, i) => i !== idx));
  };

  const captureFromCamera = async () => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const context = canvas.getContext('2d');
      if (context) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        if (facingMode === 'user') {
          context.translate(canvas.width, 0);
          context.scale(-1, 1);
        }
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const optimized = await resizeImage(canvas.toDataURL('image/jpeg', 0.9));
        setMyReferences(prev => [...prev, optimized].slice(-MAX_REFERENCES));
        setShowCamera(false);
      }
    }
  };

  const handleReferenceUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []) as File[];
    if (files.length === 0) return;

    console.log(`[App] Processing ${files.length} reference images sequentially...`);
    setIsProcessingRefs(true);
    try {
      const processedImages: string[] = [];
      for (const file of files) {
        const base64 = await new Promise<string>((resolve, reject) => {
          const r = new FileReader();
          r.onload = (ev) => resolve(ev.target?.result as string);
          r.onerror = (err) => reject(err);
          r.readAsDataURL(file);
        });
        // Use smaller size for references to save memory and improve sync speed
        const opt = await resizeImage(base64, 768, 768);
        processedImages.push(opt);
        // Small delay to prevent UI freezing and memory spikes
        await new Promise(resolve => setTimeout(resolve, 150));
      }
      
      console.log(`[App] Successfully processed ${processedImages.length} images.`);
      setMyReferences(prev => [...prev, ...processedImages].slice(-MAX_REFERENCES));
    } catch (err) {
      console.error("[App] Reference upload failed", err);
      setGenError("Failed to process reference images.");
    } finally {
      setIsProcessingRefs(false);
      e.target.value = '';
    }
  };

  const goToStep = (step: 1 | 2 | 3) => {
    if (step === currentStep) return;
    setDirection(step > currentStep ? 1 : -1);
    setCurrentStep(step);
  };

  const handleGenerate = async () => {
    if (!isReadyToSync || isGenerating || isEditing) return;
    setView('results');
    setIsGenerating(true);
    setGenError(null);
    try {
      const result = await generateSwappedImage(extractedJson, myReferences);
      if (result) {
        const newGen: GeneratedImage = { 
          id: `g-${Date.now()}`, 
          url: result, 
          prompt: extractedJson, 
          timestamp: Date.now() 
        };
        setHistory(prev => [newGen, ...prev].slice(0, MAX_HISTORY));
      } else {
        setGenError("The request was processed but no image was returned. Try adjusting your input.");
      }
    } catch (e: any) { 
      console.error(e);
      if (e.message === 'SAFETY_BLOCK') {
        setGenError("Content Blocked: The AI could not fulfill this request due to safety policies.");
      } else {
        setGenError("Something went wrong. Please check your connection and try again.");
      }
    } finally { 
      setIsGenerating(false); 
    }
  };

  const handleDownload = (url: string) => {
    const link = document.createElement('a');
    link.href = url;
    link.download = `style_${Date.now()}.png`;
    link.click();
  };

  const handleShare = async (url: string) => {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const file = new File([blob as any], 'style_sync.png', { type: 'image/png' });
      const shareData: any = { files: [file], title: 'Style Replicate AI' };
      const nav = navigator as any;

      if (nav.share && nav.canShare && nav.canShare(shareData)) {
        await nav.share(shareData);
      } else {
        handleDownload(url);
      }
    } catch (e) { 
      handleDownload(url);
    }
  };

  const isReadyToSync = inspiration !== null && 
                        myReferences.length > 0 && 
                        extractedJson !== '' && 
                        !isExtracting && 
                        !isSavingRefs && 
                        !isProcessingRefs && 
                        !isProcessingInspiration;
  const latestImage = history[0];

  const handleApplyEdit = async () => {
    if (editingIndex === null) return;
    const targetIdx = editingIndex;
    const prompt = editPrompt;
    setEditingIndex(null);
    setEditPrompt('');
    setIsEditing(true);
    setView('results');
    setGenError(null);
    try {
      const targetImage = history[targetIdx];
      if (targetImage?.url) {
        const res = await editGeneratedImage(targetImage.url, prompt);
        if (res) {
          setHistory(prev => {
            const updated = [...prev];
            updated[targetIdx] = { ...targetImage, url: res };
            return updated;
          });
        } else {
          setGenError("AI Re-touch failed: No image returned.");
        }
      }
    } catch (e: any) {
      console.error(e);
      if (e.message === 'SAFETY_BLOCK') {
        setGenError("Re-touch Blocked: Your prompt triggered a safety filter.");
      } else {
        setGenError("AI Re-touch failed. Please try again.");
      }
    } finally {
      setIsEditing(false);
    }
  };

  const deleteFromVault = (id: string) => {
    setHistory(prev => prev.filter(item => item.id !== id));
  };

  const clearAllVault = async () => {
    try {
      await storage.clearAll();
    } catch (err) {
      console.error("Failed to clear storage:", err);
    }
    // Always clear state manually to ensure UI updates without reload
    setHistory([]);
    setStylesLibrary([]);
    setMyReferences([]);
    setInspiration(null);
    setExtractedJson('');
    setGenError(null);
    goToStep(1);
    storage.setItem(STEP_KEY, 1);
    setView('home');
    setStatusMsg('Data cleared successfully');
    setTimeout(() => setStatusMsg(''), 3000);
  };

  return (
    <div 
      className="flex flex-col h-screen gradient-bg overflow-hidden text-[#1A1C1E]"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {!isLoaded && (
        <div className="fixed inset-0 z-[100] bg-white flex flex-col items-center justify-center">
          <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-4"></div>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Restoring Session...</p>
        </div>
      )}

      {showCamera && (
        <div className="fixed inset-0 z-[60] bg-black flex flex-col items-center justify-center p-4">
          <div className="relative w-full max-w-lg aspect-square overflow-hidden rounded-3xl border-2 border-white/20">
            <video ref={videoRef} autoPlay playsInline className={`w-full h-full object-cover ${facingMode === 'user' ? 'scale-x-[-1]' : ''}`} />
          </div>
          <div className="mt-8 flex items-center gap-8">
            <button onClick={() => setShowCamera(false)} className="bg-white/10 text-white p-4 rounded-full"><Icons.Trash /></button>
            <button onClick={captureFromCamera} className="w-20 h-20 rounded-full border-4 border-white flex items-center justify-center bg-white shadow-xl">
              <div className="w-16 h-16 rounded-full border-2 border-black bg-slate-200" />
            </button>
            <button onClick={() => setFacingMode(prev => prev === 'user' ? 'environment' : 'user')} className="bg-white/10 text-white p-4 rounded-full"><Icons.Switch /></button>
          </div>
          <canvas ref={canvasRef} className="hidden" />
        </div>
      )}

      <header className="px-6 pt-4 pb-0 flex items-center justify-center bg-transparent z-10 relative">
        {view !== 'home' && (
          <button onClick={() => setView('home')} className="absolute left-6 w-8 h-8 rounded-full bg-white flex items-center justify-center shadow-sm active:scale-95 transition-transform">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M15 18l-6-6 6-6"/></svg>
          </button>
        )}
        <div className="flex flex-col items-center">
          <h1 className="text-xl font-bold tracking-tight text-center">
            Style Replicate AI
          </h1>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto px-6 pb-32 custom-scrollbar">
        {view === 'results' && (
          <div className="space-y-2 animate-in fade-in duration-500">
            <div className="flex bg-slate-200/50 backdrop-blur-md p-1 rounded-2xl mb-2">
              <button 
                onClick={() => setResultsTab('latest')}
                className={`flex-1 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${resultsTab === 'latest' ? 'bg-white/90 text-blue-600 shadow-sm neon-glow' : 'text-slate-500'}`}
              >
                Latest Generation
              </button>
              <button 
                onClick={() => setResultsTab('history')}
                className={`flex-1 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${resultsTab === 'history' ? 'bg-white/90 text-blue-600 shadow-sm neon-glow' : 'text-slate-500'}`}
              >
                History Vault
              </button>
            </div>

            <div className="relative overflow-hidden min-h-[400px]">
              <AnimatePresence initial={false} mode="wait">
                <motion.div
                  key={resultsTab}
                  initial={{ opacity: 0, x: resultsTab === 'latest' ? -20 : 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: resultsTab === 'latest' ? 20 : -20 }}
                  transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                  className="w-full"
                >
                  {resultsTab === 'latest' && (
                    <div className="space-y-2">
                      <div className="glass-card rounded-[2rem] p-2 relative">
                        <div className="aspect-[3/4] rounded-[1.5rem] overflow-hidden bg-slate-100/50 relative group">
                          {(isGenerating || isEditing) ? (
                            <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-50/80 backdrop-blur-sm z-20">
                              <div className="relative mb-6">
                                <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                                <div className="absolute inset-0 flex items-center justify-center">
                                  <span className="text-[10px] font-black text-blue-600">{timer}s</span>
                                </div>
                              </div>
                              <p className="text-[10px] font-black text-blue-600 uppercase tracking-widest animate-pulse mb-1 px-4 text-center">{statusMsg}</p>
                            </div>
                          ) : genError ? (
                            <div className="absolute inset-0 flex flex-col items-center justify-center bg-red-50 p-8 text-center animate-in fade-in">
                              <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center text-red-500 mb-4">
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                              </div>
                              <h3 className="text-red-700 font-bold text-[10px] uppercase tracking-widest mb-2">Notice</h3>
                              <p className="text-[10px] text-red-600/80 leading-relaxed mb-6">{genError}</p>
                              <button onClick={() => setGenError(null)} className="px-5 py-2 bg-red-500 text-white rounded-full font-bold text-[10px] shadow-lg shadow-red-200 active:scale-95 transition-transform">Dismiss</button>
                            </div>
                          ) : latestImage ? (
                            <>
                              <img src={latestImage.url} className="w-full h-full object-cover" alt="Result" />
                              <div className="absolute top-3 right-3">
                                <button onClick={() => deleteFromVault(latestImage.id)} className="w-8 h-8 bg-red-500 text-white rounded-full flex items-center justify-center shadow-lg active:scale-90 transition-transform">
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M18 6L6 18M6 6l12 12"/></svg>
                                </button>
                              </div>
                              <div className="absolute bottom-3 right-3 flex gap-2">
                                <button onClick={() => handleShare(latestImage.url)} className="w-10 h-10 bg-white/90 backdrop-blur rounded-full flex items-center justify-center shadow-lg text-blue-600 active:scale-90 transition-transform"><Icons.Share /></button>
                                <button onClick={() => handleDownload(latestImage.url)} className="w-10 h-10 bg-white/90 backdrop-blur rounded-full flex items-center justify-center shadow-lg text-blue-600 active:scale-90 transition-transform"><Icons.Download /></button>
                              </div>
                            </>
                          ) : (
                            <div className="w-full h-full flex flex-col items-center justify-center text-slate-300 p-8 text-center">
                              <Icons.Magic />
                              <p className="mt-2 text-[10px] font-medium">Ready to replicate styles. Upload an inspiration to begin.</p>
                            </div>
                          )}
                        </div>
                        <div className="grid grid-cols-2 gap-2 mt-2">
                          <button 
                            onClick={() => setEditingIndex(0)} 
                            disabled={!latestImage || isGenerating || isEditing} 
                            className="flex items-center justify-center gap-2 py-3 px-4 bg-[#11141D] text-white rounded-xl font-bold text-[11px] active:scale-95 transition-all disabled:opacity-20"
                          >
                            <Icons.Magic className="w-4 h-4" />
                            <span>AI Re-touch</span>
                          </button>
                          <button 
                            onClick={handleGenerate} 
                            disabled={isGenerating || isEditing || !isReadyToSync} 
                            className="flex items-center justify-center gap-2 py-3 px-4 bg-[#2D66F6] text-white rounded-xl font-bold text-[11px] active:scale-95 transition-all shadow-lg shadow-blue-200/50 disabled:opacity-50"
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>
                            <span>Regenerate</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {resultsTab === 'history' && (
                    <div className="space-y-4 animate-in fade-in duration-300">
                      <div className="flex items-center justify-between px-1">
                        <div className="flex items-center gap-2">
                          <span className="bg-slate-200 px-2 py-0.5 rounded-md text-[10px] font-bold text-slate-600">{history.length}/{MAX_HISTORY}</span>
                        </div>
                        {history.length > 0 && <button onClick={clearAllVault} className="text-[10px] font-bold text-red-500 active:opacity-50 uppercase tracking-tighter">Clear All</button>}
                      </div>
                      {history.length > 0 ? (
                        <div className="grid grid-cols-3 gap-3">
                          {history.map((item) => (
                            <div key={item.id} className="aspect-square rounded-2xl overflow-hidden glass-card relative group neon-glow">
                              <img src={item.url} className="w-full h-full object-cover" />
                              <button onClick={(e) => { e.stopPropagation(); deleteFromVault(item.id); }} className="absolute top-1 right-1 bg-red-500/90 text-white p-1.5 rounded-full shadow-lg active:scale-90 z-10"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="py-20 flex flex-col items-center justify-center text-slate-300">
                          <Icons.History className="w-12 h-12 opacity-20 mb-4" />
                          <p className="text-[10px] font-bold uppercase tracking-widest">Vault is empty</p>
                        </div>
                      )}
                    </div>
                  )}
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        )}

        {view === 'home' && (
          <div className="space-y-2">
            {(currentStep === 1 || currentStep === 2) && (
              <>
                <div className="flex bg-slate-200/50 backdrop-blur-md p-1 rounded-2xl mb-0">
                  <button 
                    onClick={() => goToStep(1)}
                    className={`flex-1 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${currentStep === 1 ? 'bg-white/90 text-blue-600 shadow-sm neon-glow' : 'text-slate-500'}`}
                  >
                    1. References
                  </button>
                  <button 
                    onClick={() => goToStep(2)}
                    className={`flex-1 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${currentStep === 2 ? 'bg-white/90 text-blue-600 shadow-sm neon-glow' : 'text-slate-500'}`}
                  >
                    2. Inspiration
                  </button>
                </div>

                <div className="relative overflow-hidden min-h-[380px]">
                  <AnimatePresence initial={false} custom={direction} mode="wait">
                    <motion.div
                      key={currentStep}
                      custom={direction}
                      initial={{ x: direction > 0 ? 50 : -50, opacity: 0 }}
                      animate={{ x: 0, opacity: 1 }}
                      exit={{ x: direction > 0 ? -50 : 50, opacity: 0 }}
                      transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                      className="w-full"
                    >
                      {currentStep === 1 && (
                        <div className="glass-card p-4 rounded-[2rem]">
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <span className="bg-slate-100 text-slate-500 text-[10px] font-black px-2 py-0.5 rounded-full uppercase tracking-widest">
                                {myReferences.length}/5
                              </span>
                              {myReferences.length > 0 && !isSavingRefs && !isProcessingRefs && (
                                <span className="bg-emerald-100 text-emerald-600 text-[8px] font-black px-1.5 py-0.5 rounded-full uppercase tracking-widest flex items-center gap-1">
                                  <Icons.Check /> Ready
                                </span>
                              )}
                            </div>
                            {myReferences.length > 0 && <button onClick={() => setMyReferences([])} className="text-red-400 font-bold text-[10px] uppercase tracking-tighter">Remove All</button>}
                          </div>
                          <div className="grid grid-cols-3 gap-3 pb-4 min-h-[380px]">
                            {/* Images 1-5 */}
                            {myReferences.map((r, i) => (
                              <div key={i} className="aspect-square rounded-2xl overflow-hidden bg-slate-100/50 relative border border-white/20 neon-glow">
                                <img src={r} className="w-full h-full object-cover" />
                                <button onClick={() => setMyReferences(prev => prev.filter((_, idx) => idx !== i))} className="absolute top-1 right-1 bg-red-500 text-white p-1 rounded-full shadow-lg active:scale-90 transition-transform"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
                              </div>
                            ))}
                            
                            {/* Fill empty slots to push buttons to bottom right of a 4-row grid (12 slots total) */}
                            {/* 12 slots - 2 buttons = 10 slots for images + spacers */}
                            {Array.from({ length: 10 - myReferences.length }).map((_, i) => (
                              <div key={`empty-${i}`} className="aspect-square" />
                            ))}

                            {/* Camera and Gallery at the bottom right */}
                            <button onClick={() => setShowCamera(true)} className="aspect-square rounded-2xl border-2 border-dashed border-blue-200 flex flex-col items-center justify-center text-blue-400 bg-blue-50/30 hover:bg-blue-50 transition-colors">
                              <Icons.Camera /><span className="text-[10px] font-bold mt-1">Camera</span>
                            </button>
                            <label className="aspect-square rounded-2xl border-2 border-dashed border-slate-200 flex flex-col items-center justify-center text-slate-300 cursor-pointer hover:bg-slate-50 transition-colors">
                              <Icons.Upload /><span className="text-[10px] font-bold mt-1">Gallery</span>
                              <input key={myReferences.length} type="file" hidden multiple onChange={handleReferenceUpload} />
                            </label>
                          </div>
                        </div>
                      )}

                      {currentStep === 2 && (
                        <div className="glass-card p-4 rounded-[2rem]">
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              {extractedJson && !isExtracting && !isProcessingInspiration && (
                                <span className="bg-emerald-100 text-emerald-600 text-[8px] font-black px-1.5 py-0.5 rounded-full uppercase tracking-widest flex items-center gap-1">
                                  <Icons.Check /> Ready
                                </span>
                              )}
                              {(isExtracting || isProcessingInspiration) && (
                                <span className="bg-blue-100 text-blue-600 text-[8px] font-black px-1.5 py-0.5 rounded-full uppercase tracking-widest flex items-center gap-1 animate-pulse">
                                  <div className="w-2 h-2 border border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                                  {isProcessingInspiration ? 'Processing...' : 'Analyzing...'}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-4">
                              {inspiration && <button onClick={() => { setInspiration(null); setExtractedJson(''); setGenError(null); }} className="text-red-400 font-bold text-[10px] uppercase tracking-tighter">Clear</button>}
                            </div>
                          </div>
                          <label className={`block w-full min-h-[350px] rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50 relative overflow-hidden group cursor-pointer transition-all ${inspiration ? 'border-solid border-blue-100' : 'hover:border-blue-400'}`}>
                            {inspiration ? <img src={inspiration} className="w-full max-h-[400px] object-contain mx-auto" /> : (
                              <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-400">
                                <Icons.Upload /><span className="text-xs mt-2 font-bold uppercase tracking-tighter">Upload Pinterest/IG Style</span>
                              </div>
                            )}
                            <input key={inspiration ? 'active' : 'empty'} type="file" hidden onChange={handleInspirationUpload} accept="image/*" />
                          </label>
                          
                          {genError && (
                            <div className="mt-4 p-4 bg-red-50 rounded-2xl border border-red-100">
                              <p className="text-[11px] text-red-600 font-bold mb-2">{genError}</p>
                              <button 
                                onClick={() => inspiration && runStyleAnalysis(inspiration)}
                                className="text-[10px] font-black uppercase tracking-widest text-white bg-red-500 px-4 py-2 rounded-lg"
                              >
                                Retry Analysis
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </motion.div>
                  </AnimatePresence>
                </div>
              </>
            )}
          </div>
        )}

        {view === 'styles' && (
          <div className="space-y-2 pt-2 animate-in slide-in-from-right-4 duration-500">
            <div className="flex items-center gap-2 mb-2">
              <span className="glass-card px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest text-blue-600 neon-glow">
                Inspiration Library
              </span>
              <span className="bg-slate-200 text-slate-600 px-2 py-0.5 rounded-md text-[10px] font-bold">
                {stylesLibrary.length}/{MAX_LIBRARY}
              </span>
            </div>
            {stylesLibrary.length > 0 ? (
              <div className="grid grid-cols-3 gap-3">
                {stylesLibrary.map((style, i) => (
                  <div 
                    key={i} 
                    onClick={() => applyLibraryStyle(style)}
                    className="aspect-square rounded-2xl glass-card overflow-hidden relative cursor-pointer active:scale-[0.98] transition-all group neon-glow"
                  >
                    <img src={style} className="w-full h-full object-cover" />
                    <button 
                      onClick={(e) => deleteFromLibrary(i, e)}
                      className="absolute top-1 right-1 w-7 h-7 bg-red-500/90 text-white rounded-full flex items-center justify-center shadow-lg active:scale-90 transition-transform z-10"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M18 6L6 18M6 6l12 12"/></svg>
                    </button>
                    <div className="absolute inset-0 bg-blue-600/10 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-20 text-center text-slate-400">
                <p className="text-sm font-bold uppercase tracking-widest mb-2">No Saved Styles</p>
                <p className="text-xs">Styles you upload to the Home tab will appear here automatically.</p>
              </div>
            )}
          </div>
        )}

        {view === 'profile' && (
          <div className="space-y-2 pt-2 animate-in slide-in-from-left-4 duration-500">
            <div className="flex items-center gap-2 mb-2">
              <span className="glass-card px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest text-blue-600 neon-glow">
                User Preferences
              </span>
            </div>
            <div className="glass-card p-6 rounded-[2rem] flex items-center gap-4">
              <div className="w-16 h-16 rounded-full bg-slate-100/50 flex items-center justify-center text-slate-400"><Icons.User /></div>
              <div><p className="font-bold">Creative User</p><p className="text-xs text-slate-400">Free Tier Plan</p></div>
            </div>
            <div className="p-4 bg-yellow-50 rounded-2xl border border-yellow-100 text-yellow-800 text-xs font-medium">
               To prevent performance issues, history is limited to {MAX_HISTORY} items and saved styles to {MAX_LIBRARY} items.
            </div>
            <button 
              onClick={clearAllVault}
              className="w-full py-4 bg-red-50 text-red-600 rounded-2xl font-bold text-sm border border-red-100 active:bg-red-100"
            >
              Clear All Data & Cache
            </button>
          </div>
        )}
      </main>

      {editingIndex !== null && (
        <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/40 backdrop-blur-sm p-4" onClick={() => !isEditing && setEditingIndex(null)}>
          <div className="w-full max-w-md bg-white rounded-[2rem] p-6 shadow-2xl animate-in slide-in-from-bottom-10" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-4">Refine with AI</h3>
            <textarea className="w-full h-32 bg-slate-100 rounded-2xl p-4 text-sm outline-none focus:ring-2 ring-blue-500/20" placeholder="e.g. 'Change background to beach'..." value={editPrompt} onChange={(e) => setEditPrompt(e.target.value)} />
            <div className="grid grid-cols-2 gap-3 mt-4">
               <button onClick={() => setEditingIndex(null)} className="py-4 bg-slate-100 rounded-2xl font-bold">Cancel</button>
               <button onClick={handleApplyEdit} disabled={!editPrompt.trim() || isEditing} className="py-4 bg-blue-600 text-white rounded-2xl font-bold disabled:opacity-50">{isEditing ? 'Syncing...' : 'Apply'}</button>
            </div>
          </div>
        </div>
      )}

      <nav className="fixed bottom-0 left-0 right-0 h-24 glass-nav px-8 flex items-center justify-between pb-6 z-40">
        <button onClick={() => setView('home')} className={`flex flex-col items-center gap-1 ${view === 'home' ? 'text-blue-600' : 'text-slate-400'}`}>
          <div className={`p-1 ${view === 'home' ? 'neon-glow rounded-full bg-white/50' : ''}`}><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg></div>
          <span className="text-[10px] font-bold uppercase tracking-tighter">Home</span>
        </button>
        <button onClick={() => setView('results')} className={`flex flex-col items-center gap-1 ${view === 'results' ? 'text-blue-600' : 'text-slate-400'}`}>
          <div className={`p-1 ${view === 'results' ? 'neon-glow rounded-full bg-white/50' : ''}`}><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="9" y1="3" x2="9" y2="21"/></svg></div>
          <span className="text-[10px] font-bold uppercase tracking-tighter">Results</span>
        </button>
        <div className="relative -top-10">
          <button onClick={handleGenerate} disabled={isGenerating || isEditing || isExtracting || !isReadyToSync} className={`w-16 h-16 rounded-full flex flex-col items-center justify-center transition-all border-4 border-white/50 active:scale-95 ${isReadyToSync ? 'go-button-gradient text-white' : 'bg-slate-200 text-slate-400 shadow-none'}`}>
            {isGenerating || isEditing || isExtracting ? (
              <div className="relative"><div className="w-8 h-8 border-4 border-white border-t-transparent rounded-full animate-spin"></div><span className="absolute inset-0 flex items-center justify-center text-[8px] font-black text-white">{timer}s</span></div>
            ) : <span className="text-sm font-black italic tracking-tighter">GO</span>}
          </button>
        </div>
        <button onClick={() => setView('styles')} className={`flex flex-col items-center gap-1 ${view === 'styles' ? 'text-blue-600' : 'text-slate-400'}`}>
          <div className={`p-1 ${view === 'styles' ? 'neon-glow rounded-full bg-white/50' : ''}`}><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg></div>
          <span className="text-[10px] font-bold uppercase tracking-tighter">Library</span>
        </button>
        <button onClick={() => setView('profile')} className={`flex flex-col items-center gap-1 ${view === 'profile' ? 'text-blue-600' : 'text-slate-400'}`}>
          <div className={`p-1 ${view === 'profile' ? 'neon-glow rounded-full bg-white/50' : ''}`}><Icons.User /></div>
          <span className="text-[10px] font-bold uppercase tracking-tighter">Profile</span>
        </button>
      </nav>
    </div>
  );
};

export default App;
