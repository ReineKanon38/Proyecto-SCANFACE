import React, { useState, useEffect, useRef } from 'react';

const API_BASE = 'http://localhost:8000';

function App() {
  const [activeTab, setActiveTab] = useState('scan'); // 'scan' | 'admin'
  const [adminTab, setAdminTab] = useState('register'); // 'register' | 'students' | 'logs'
  const [isAdminLoggedIn, setIsAdminLoggedIn] = useState(false);
  const [adminPassword, setAdminPassword] = useState('');
  
  // Data States
  const [students, setStudents] = useState([]);
  const [logs, setLogs] = useState([]);
  const [liveLogs, setLiveLogs] = useState([]);
  
  // Stream & WebSocket States
  const [streamMode, setStreamMode] = useState('local'); // 'local' | 'cloud'
  const [wsConnected, setWsConnected] = useState(false);
  const [facesData, setFacesData] = useState([]);
  const [cameraSrc, setCameraSrc] = useState('');
  const [isCameraOn, setIsCameraOn] = useState(false);
  
  // Forms & Loading
  const [studentId, setStudentId] = useState('');
  const [fullName, setFullName] = useState('');
  const [photos, setPhotos] = useState({
    frontal: null,
    accessories: null
  });
  const [photoPreviews, setPhotoPreviews] = useState({
    frontal: null,
    accessories: null
  });
  
  const [isLoading, setIsLoading] = useState(false);
  const [toast, setToast] = useState({ text: '', type: '' }); // type: 'success' | 'error'
  
  const fileFrontalRef = useRef(null);
  const fileAccessoriesRef = useRef(null);
  
  // Camera & WebSocket Refs
  const videoRef = useRef(null);
  const hiddenCanvasRef = useRef(null);
  const localStreamRef = useRef(null);
  const wsRef = useRef(null);
  const wsLoopRef = useRef(null);

  // Auto-clear Toast
  useEffect(() => {
    if (toast.text) {
      const timer = setTimeout(() => setToast({ text: '', type: '' }), 5000);
      return () => clearTimeout(timer);
    }
  }, [toast.text]);

  // Load Data
  const loadStudents = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/students`);
      if (res.ok) {
        const data = await res.json();
        setStudents(data);
      }
    } catch (e) {
      console.error("Error loading students:", e);
    }
  };

  const loadLogs = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/logs`);
      if (res.ok) {
        const data = await res.json();
        setLogs(data);
        // Take the first 8 for the live scan log feed
        setLiveLogs(data.slice(0, 8));
      }
    } catch (e) {
      console.error("Error loading logs:", e);
    }
  };

  // Poll Logs on Scanner view
  useEffect(() => {
    loadLogs();
    loadStudents();

    let interval;
    if (activeTab === 'scan') {
      interval = setInterval(loadLogs, 2000);
    } else if (isAdminLoggedIn) {
      interval = setInterval(() => {
        loadLogs();
        loadStudents();
      }, 5000);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [activeTab, isAdminLoggedIn]);

  // Turn off camera automatically when leaving the scan tab
  useEffect(() => {
    if (activeTab !== 'scan') {
      setIsCameraOn(false);
    }
  }, [activeTab]);

  // Manage Local Camera Source string to turn off camera when switching tabs/modes
  useEffect(() => {
    if (activeTab === 'scan' && streamMode === 'local' && isCameraOn) {
      setCameraSrc(`${API_BASE}/api/video_feed?t=${Date.now()}`);
    } else {
      setCameraSrc('');
      // Force shutdown of local camera stream in the backend
      fetch(`${API_BASE}/api/camera/off`, { method: 'POST' }).catch(err => {
        console.error("Error shutting down camera in backend:", err);
      });
    }
  }, [activeTab, streamMode, isCameraOn]);

  // Setup/Teardown WebSocket Stream (Cloud Mode)
  useEffect(() => {
    const cleanup = () => {
      if (wsLoopRef.current) {
        clearInterval(wsLoopRef.current);
        wsLoopRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
        localStreamRef.current = null;
      }
      setWsConnected(false);
      setFacesData([]);
    };

    if (activeTab === 'scan' && streamMode === 'cloud' && isCameraOn) {
      let isStopped = false;
      
      const initCameraAndWS = async () => {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            video: { width: 640, height: 480 }
          });
          if (isStopped) {
            stream.getTracks().forEach(track => track.stop());
            return;
          }
          localStreamRef.current = stream;
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
          }

          const wsUrl = API_BASE.replace('http', 'ws') + '/api/ws_video_feed';
          const socket = new WebSocket(wsUrl);
          wsRef.current = socket;

          socket.onopen = () => {
            if (isStopped) {
              socket.close();
              return;
            }
            setWsConnected(true);
            
            wsLoopRef.current = setInterval(() => {
              if (videoRef.current && hiddenCanvasRef.current && socket.readyState === WebSocket.OPEN) {
                const canvas = hiddenCanvasRef.current;
                const video = videoRef.current;
                const context = canvas.getContext('2d');
                if (video.videoWidth) {
                  context.drawImage(video, 0, 0, canvas.width, canvas.height);
                  const dataUrl = canvas.toDataURL('image/jpeg', 0.6);
                  socket.send(JSON.stringify({ image: dataUrl }));
                }
              }
            }, 100); // Send frame every 100ms
          };

          socket.onmessage = (event) => {
            try {
              const data = JSON.parse(event.data);
              if (data.faces) {
                setFacesData(data.faces);
              }
            } catch (err) {
              console.error("Error parsing WS message:", err);
            }
          };

          socket.onerror = (err) => {
            console.error("WS error:", err);
          };

          socket.onclose = () => {
            setWsConnected(false);
            setFacesData([]);
          };

        } catch (err) {
          console.error("Failed to initialize WebSocket stream:", err);
          setToast({ text: 'No se pudo acceder a la cámara o conectar al servidor WebSocket', type: 'error' });
          setStreamMode('local');
        }
      };

      initCameraAndWS();

      return () => {
        isStopped = true;
        cleanup();
      };
    } else {
      cleanup();
    }
  }, [activeTab, streamMode, isCameraOn]);

  // Handle Admin Login
  const handleLogin = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      const formData = new FormData();
      formData.append('password', adminPassword);
      
      const res = await fetch(`${API_BASE}/api/login`, {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      
      if (res.ok && data.success) {
        setIsAdminLoggedIn(true);
        setAdminPassword('');
        setToast({ text: 'Acceso concedido como Administrador', type: 'success' });
        loadStudents();
        loadLogs();
      } else {
        setToast({ text: data.detail || 'Contraseña incorrecta', type: 'error' });
      }
    } catch (err) {
      setToast({ text: 'Error al conectar con el servidor', type: 'error' });
    } finally {
      setIsLoading(false);
    }
  };

  // Handle Photo Selection
  const handlePhotoChange = (side, file) => {
    if (!file) return;
    setPhotos(prev => ({ ...prev, [side]: file }));
    
    // Create preview URL
    const reader = new FileReader();
    reader.onloadend = () => {
      setPhotoPreviews(prev => ({ ...prev, [side]: reader.result }));
    };
    reader.readAsDataURL(file);
  };

  // Handle Student Registration
  const handleRegister = async (e) => {
    e.preventDefault();
    if (!studentId || !fullName || !photos.frontal || !photos.accessories) {
      setToast({ text: 'Por favor complete todos los campos y suba las 2 fotografías.', type: 'error' });
      return;
    }

    setIsLoading(true);
    try {
      const formData = new FormData();
      formData.append('student_id', studentId);
      formData.append('name', fullName);
      formData.append('photo_frontal', photos.frontal);
      formData.append('photo_accessories', photos.accessories);

      const res = await fetch(`${API_BASE}/api/register`, {
        method: 'POST',
        body: formData
      });
      const data = await res.json();

      if (res.ok && data.success) {
        setToast({ text: data.message, type: 'success' });
        // Clear inputs
        setStudentId('');
        setFullName('');
        setPhotos({ frontal: null, accessories: null });
        setPhotoPreviews({ frontal: null, accessories: null });
        loadStudents();
      } else {
        setToast({ text: data.detail || 'Error al registrar al alumno', type: 'error' });
      }
    } catch (err) {
      setToast({ text: 'Error al conectar con el servidor', type: 'error' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogout = () => {
    setIsAdminLoggedIn(false);
    setToast({ text: 'Sesión de Administrador cerrada', type: 'success' });
  };

  // Format Iso Timestamps
  const formatTime = (isoString) => {
    try {
      const date = new Date(isoString);
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch (e) {
      return isoString;
    }
  };

  const formatDate = (isoString) => {
    try {
      const date = new Date(isoString);
      return date.toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' });
    } catch (e) {
      return '';
    }
  };

  return (
    <div className="min-h-screen flex flex-col pb-12">
      {/* Toast Notification */}
      {toast.text && (
        <div className={`fixed top-6 right-6 z-50 px-6 py-4 rounded-xl shadow-2xl backdrop-blur-xl border flex items-center gap-3 animate-slide-in ${
          toast.type === 'success' 
            ? 'bg-emerald-950/80 border-emerald-500/30 text-emerald-300' 
            : 'bg-rose-950/80 border-rose-500/30 text-rose-300'
        }`}>
          {toast.type === 'success' ? (
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          ) : (
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          )}
          <span className="font-medium">{toast.text}</span>
        </div>
      )}

      {/* Main Glass Header */}
      <header className="w-full max-w-7xl mx-auto px-6 mt-6">
        <div className="glass-panel px-8 py-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="relative flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-500 to-purple-600 shadow-lg shadow-indigo-500/30">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1.001 1.001 0 011 1.001v2M2 5h1c.55 0 1 .45 1 1v2m9-6h2m-4 0H9m13 8v2" />
              </svg>
              {/* Scan Line effect */}
              <div className="absolute inset-x-0 h-0.5 bg-cyan-400 top-1/2 -translate-y-1/2 pulse"></div>
            </div>
            <div>
              <h1 className="text-xl font-extrabold tracking-wider bg-gradient-to-r from-indigo-300 via-purple-300 to-cyan-300 bg-clip-text text-transparent m-0">SCANFACE</h1>
              <p className="text-[10px] text-indigo-400 font-semibold tracking-widest uppercase m-0">Reconocimiento Facial de Asistencia</p>
            </div>
          </div>

          <nav className="flex items-center gap-4">
            <button 
              onClick={() => setActiveTab('scan')} 
              className={`px-5 py-2.5 rounded-lg font-medium transition-all duration-300 flex items-center gap-2 ${
                activeTab === 'scan' 
                  ? 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-md shadow-indigo-600/20' 
                  : 'text-gray-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              Escanear Asistencia
            </button>
            <button 
              onClick={() => setActiveTab('admin')} 
              className={`px-5 py-2.5 rounded-lg font-medium transition-all duration-300 flex items-center gap-2 ${
                activeTab === 'admin' 
                  ? 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-md shadow-indigo-600/20' 
                  : 'text-gray-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              Administración
            </button>
          </nav>

          <div className="flex items-center gap-3">
            <span className="flex h-2 w-2 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            <span className="text-xs text-gray-400 font-semibold tracking-wider">SUPABASE: ONLINE</span>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="w-full max-w-7xl mx-auto px-6 mt-6 flex-1 flex flex-col">
        {activeTab === 'scan' ? (
          /* SCANNER TAB */
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch flex-1">
            {/* Camera Frame Column */}
            <div className="lg:col-span-7 flex flex-col">
              <div className="glass-panel p-6 flex-1 flex flex-col items-center justify-between relative overflow-hidden min-h-[480px]">
                {/* Control switches at the top */}
                <div className="z-10 flex flex-wrap gap-3 mb-4 w-full justify-center items-center">
                  <button 
                    onClick={() => setStreamMode('local')}
                    className={`px-4 py-2 rounded-lg font-semibold text-xs transition-all duration-300 ${
                      streamMode === 'local' 
                        ? 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-md shadow-indigo-600/20' 
                        : 'bg-white/5 text-gray-400 hover:text-white hover:bg-white/10'
                    }`}
                  >
                    Modo Local (Servidor/Webcam USB)
                  </button>
                  <button 
                    onClick={() => setStreamMode('cloud')}
                    className={`px-4 py-2 rounded-lg font-semibold text-xs transition-all duration-300 ${
                      streamMode === 'cloud' 
                        ? 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-md shadow-indigo-600/20' 
                        : 'bg-white/5 text-gray-400 hover:text-white hover:bg-white/10'
                    }`}
                  >
                    Modo Nube (Navegador/WebSocket)
                  </button>

                  <div className="w-[1px] h-6 bg-white/10 mx-1 hidden sm:block"></div>

                  <button 
                    onClick={() => setIsCameraOn(!isCameraOn)}
                    className={`px-4 py-2 rounded-lg font-bold text-xs transition-all duration-300 flex items-center gap-1.5 ${
                      isCameraOn 
                        ? 'bg-rose-500/20 border border-rose-500/30 text-rose-300 hover:bg-rose-500/30' 
                        : 'bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/30'
                    }`}
                  >
                    <span className={`w-2 h-2 rounded-full ${isCameraOn ? 'bg-rose-400 animate-pulse' : 'bg-emerald-400'}`}></span>
                    {isCameraOn ? 'Desactivar Cámara' : 'Activar Cámara'}
                  </button>
                </div>

                {/* Scanner Target Box Corners */}
                <div className="absolute top-20 left-8 w-8 h-8 border-t-4 border-l-4 border-indigo-500 rounded-tl"></div>
                <div className="absolute top-20 right-8 w-8 h-8 border-t-4 border-r-4 border-indigo-500 rounded-tr"></div>
                <div className="absolute bottom-20 left-8 w-8 h-8 border-b-4 border-l-4 border-indigo-500 rounded-bl"></div>
                <div className="absolute bottom-20 right-8 w-8 h-8 border-b-4 border-r-4 border-indigo-500 rounded-br"></div>
                
                {/* Scanning Laser Line */}
                <div className="absolute w-[90%] left-[5%] h-[2px] bg-gradient-to-r from-transparent via-cyan-400 to-transparent top-12 pulse" style={{
                  animation: 'pulse 3s infinite ease-in-out',
                  boxShadow: '0 0 12px 2px rgba(34, 211, 238, 0.5)'
                }}></div>

                {streamMode === 'local' ? (
                  <div className="w-full max-w-2xl rounded-xl border border-white/10 overflow-hidden bg-black shadow-inner flex items-center justify-center relative min-h-[360px]">
                    {isCameraOn && cameraSrc ? (
                      <img 
                        src={cameraSrc} 
                        alt="Camera feed"
                        className="w-full h-auto object-cover min-h-[360px]"
                        onError={(e) => {
                          e.target.style.display = 'none';
                          e.target.nextSibling.style.display = 'flex';
                        }}
                      />
                    ) : (
                      <div className="w-full h-[360px] bg-slate-950 flex flex-col items-center justify-center gap-4 text-gray-400 p-8 text-center">
                        <svg className="w-12 h-12 text-indigo-400/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                        <div>
                          <p className="text-white font-bold text-sm mb-1">Cámara Apagada</p>
                          <p className="text-xs text-gray-500 max-w-xs mx-auto">Haga clic en el botón "Activar Cámara" para iniciar la detección facial local.</p>
                        </div>
                      </div>
                    )}
                    <div className="hidden absolute inset-0 bg-slate-950 flex-col items-center justify-center gap-4 text-gray-400 p-8 text-center">
                      <svg className="w-16 h-16 text-rose-500 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                      <div>
                        <h3 className="text-white font-bold text-lg mb-1">Cámara no Detectada</h3>
                        <p className="text-sm text-gray-400 max-w-sm">Asegúrese de que el servidor de Python esté activo en el puerto 8000 y que la webcam esté conectada correctamente.</p>
                      </div>
                    </div>
                  </div>
                ) : (
                  /* WebSocket Mode */
                  <div className="w-full max-w-2xl rounded-xl border border-white/10 overflow-hidden bg-black shadow-inner flex items-center justify-center relative min-h-[360px]">
                    {isCameraOn ? (
                      <>
                        <video
                          ref={videoRef}
                          autoPlay
                          playsInline
                          muted
                          className="w-full h-auto object-cover min-h-[360px]"
                          style={{ display: wsConnected ? 'block' : 'none' }}
                        />
                        <canvas ref={hiddenCanvasRef} width="640" height="480" className="hidden" />
                        
                        {wsConnected && (
                          <svg 
                            className="absolute inset-0 w-full h-full pointer-events-none"
                            viewBox="0 0 640 480"
                            preserveAspectRatio="xMidYMid slice"
                          >
                            {facesData.map((face, idx) => {
                              const [x, y, w, h] = face.box;
                              let colorHex = "#f87171"; // red
                              if (face.color === "green") colorHex = "#34d399";
                              else if (face.color === "yellow") colorHex = "#fbbf24";
                              else if (face.color === "orange") colorHex = "#fb923c";
                              
                              return (
                                <g key={idx}>
                                  <rect
                                    x={x}
                                    y={y}
                                    width={w}
                                    height={h}
                                    fill="none"
                                    stroke={colorHex}
                                    strokeWidth="2.5"
                                  />
                                  <rect
                                    x={x}
                                    y={y - 25}
                                    width={w}
                                    height="25"
                                    fill={colorHex}
                                  />
                                  <text
                                    x={x + 5}
                                    y={y - 8}
                                    fill="#000000"
                                    fontSize="12"
                                    fontWeight="bold"
                                    fontFamily="Outfit, sans-serif"
                                  >
                                    {face.label}
                                  </text>
                                  <text
                                    x={x}
                                    y={y + h + 20}
                                    fill={colorHex}
                                    fontSize="12"
                                    fontWeight="bold"
                                    fontFamily="Outfit, sans-serif"
                                  >
                                    {face.status_text}
                                  </text>
                                  {!face.is_blurry && (
                                    <text
                                      x={x}
                                      y={y + h + 38}
                                      fill="#ffffff"
                                      fontSize="12"
                                      fontFamily="Outfit, sans-serif"
                                    >
                                      Parpadeos: {face.blink_count}
                                    </text>
                                  )}
                                </g>
                              );
                            })}
                          </svg>
                        )}

                        {!wsConnected && (
                          <div className="absolute inset-0 bg-slate-950 flex flex-col items-center justify-center gap-4 text-gray-400 p-8 text-center">
                            <svg className="w-12 h-12 text-indigo-500 animate-spin" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                            </svg>
                            <p className="text-sm">Iniciando cámara y conexión WebSocket...</p>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="w-full h-[360px] bg-slate-950 flex flex-col items-center justify-center gap-4 text-gray-400 p-8 text-center">
                        <svg className="w-12 h-12 text-indigo-400/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                        <div>
                          <p className="text-white font-bold text-sm mb-1">Cámara Apagada</p>
                          <p className="text-xs text-gray-500 max-w-xs mx-auto">Haga clic en el botón "Activar Cámara" para iniciar el escaneo por WebSockets.</p>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <div className="mt-4 flex items-center gap-3 bg-white/5 px-5 py-2.5 rounded-full border border-white/5">
                  <div className={`w-2.5 h-2.5 rounded-full animate-pulse ${isCameraOn ? (streamMode === 'local' ? 'bg-cyan-400' : 'bg-indigo-400') : 'bg-gray-500'}`}></div>
                  <span className={`text-xs font-semibold tracking-wider ${isCameraOn ? (streamMode === 'local' ? 'text-cyan-300' : 'text-indigo-300') : 'text-gray-400'}`}>
                    {!isCameraOn 
                      ? 'CÁMARA APAGADA' 
                      : (streamMode === 'local' 
                        ? 'MODO LOCAL ACTIVO: Muestre su rostro y parpadee' 
                        : 'MODO NUBE ACTIVO: Transmitiendo por WebSocket'
                      )
                    }
                  </span>
                </div>
              </div>
            </div>

            {/* Live Records Column */}
            <div className="lg:col-span-5 flex flex-col">
              <div className="glass-panel p-6 flex-1 flex flex-col">
                <div className="flex items-center justify-between mb-4 border-b border-white/5 pb-3">
                  <h3 className="text-md font-bold text-white tracking-wide flex items-center gap-2">
                    <svg className="w-5 h-5 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Asistencias Recientes
                  </h3>
                  <span className="text-xs bg-indigo-500/10 text-indigo-300 px-2.5 py-1 rounded-md border border-indigo-500/20 font-semibold">
                    Hoy: {logs.length}
                  </span>
                </div>

                {/* Log list */}
                <div className="flex-1 overflow-y-auto pr-1 space-y-3 max-h-[380px]">
                  {liveLogs.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-center p-8 text-gray-500">
                      <svg className="w-12 h-12 text-gray-600 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                      </svg>
                      <p className="text-sm">Esperando registros de asistencia...</p>
                    </div>
                  ) : (
                    liveLogs.map((log) => (
                      <div key={log.id} className="glass-card p-4 flex items-center justify-between animate-slide-in">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-indigo-500/20 to-purple-500/20 border border-indigo-500/30 flex items-center justify-center font-bold text-indigo-300">
                            {log.student_name ? log.student_name.charAt(0).toUpperCase() : '?'}
                          </div>
                          <div>
                            <h4 className="text-sm font-bold text-white m-0">{log.student_name}</h4>
                            <p className="text-[11px] text-gray-400 m-0">Matrícula: {log.student_id}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <span className="text-xs bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded font-semibold block mb-0.5">
                            PRESENTE
                          </span>
                          <span className="text-[10px] text-gray-400 font-mono">{formatTime(log.timestamp)}</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* ADMIN TAB */
          <div className="glass-panel p-8 flex-1 flex flex-col">
            {!isAdminLoggedIn ? (
              /* ADMIN LOCK SCREEN */
              <div className="max-w-md mx-auto my-auto w-full glass-card p-8 text-center border border-white/5">
                <div className="w-14 h-14 bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                </div>
                <h3 className="text-lg font-bold text-white mb-1">Panel de Control Administrador</h3>
                <p className="text-sm text-gray-400 mb-6">Por favor ingrese la contraseña para desbloquear las herramientas administrativas del sistema.</p>
                
                <form onSubmit={handleLogin} className="space-y-4">
                  <input 
                    type="password" 
                    placeholder="Contraseña del Administrador" 
                    value={adminPassword}
                    onChange={(e) => setAdminPassword(e.target.value)}
                    className="form-input text-center font-mono"
                    disabled={isLoading}
                    required
                  />
                  <button type="submit" className="btn-primary w-full" disabled={isLoading}>
                    {isLoading ? 'Verificando...' : 'Iniciar Sesión'}
                  </button>
                </form>
              </div>
            ) : (
              /* ADMIN DASHBOARD CONTENT */
              <div className="flex flex-col lg:flex-row gap-8 flex-1 items-stretch">
                {/* Admin Sidebar Navigation */}
                <div className="lg:w-64 flex flex-col gap-2 border-r border-white/5 pr-0 lg:pr-8">
                  <div className="flex items-center gap-3 mb-6">
                    <div className="w-10 h-10 rounded-lg bg-indigo-500/10 text-indigo-400 flex items-center justify-center font-bold">
                      A
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-white m-0">Administrador</h4>
                      <p className="text-[10px] text-emerald-400 font-semibold uppercase tracking-wider">Sesión Activa</p>
                    </div>
                  </div>

                  <button 
                    onClick={() => setAdminTab('register')} 
                    className={`px-4 py-3 rounded-lg text-left text-sm font-semibold transition-all duration-200 flex items-center gap-2.5 ${
                      adminTab === 'register' 
                        ? 'bg-white/5 border-l-4 border-indigo-500 text-white' 
                        : 'text-gray-400 hover:text-white hover:bg-white/3'
                    }`}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                    </svg>
                    Registrar Alumno
                  </button>

                  <button 
                    onClick={() => setAdminTab('students')} 
                    className={`px-4 py-3 rounded-lg text-left text-sm font-semibold transition-all duration-200 flex items-center gap-2.5 ${
                      adminTab === 'students' 
                        ? 'bg-white/5 border-l-4 border-indigo-500 text-white' 
                        : 'text-gray-400 hover:text-white hover:bg-white/3'
                    }`}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                    </svg>
                    Alumnos Registrados
                  </button>

                  <button 
                    onClick={() => setAdminTab('logs')} 
                    className={`px-4 py-3 rounded-lg text-left text-sm font-semibold transition-all duration-200 flex items-center gap-2.5 ${
                      adminTab === 'logs' 
                        ? 'bg-white/5 border-l-4 border-indigo-500 text-white' 
                        : 'text-gray-400 hover:text-white hover:bg-white/3'
                    }`}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    Historial de Asistencia
                  </button>

                  <button 
                    onClick={handleLogout} 
                    className="mt-auto px-4 py-3 rounded-lg text-left text-sm font-semibold text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 transition-all duration-200 flex items-center gap-2.5"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                    </svg>
                    Cerrar Sesión
                  </button>
                </div>

                {/* Admin Sub-Tab View Content */}
                <div className="flex-1 flex flex-col">
                  {adminTab === 'register' && (
                    /* ENROLLMENT FORM */
                    <div className="flex flex-col gap-6 animate-slide-in">
                      <div>
                        <h3 className="text-lg font-bold text-white mb-1">Registrar Nuevo Alumno</h3>
                        <p className="text-sm text-gray-400">Ingrese los datos escolares del estudiante y cargue 3 fotos claras (tipo ficha penitenciaria / ficha de registro) para generar los embeddings faciales de control.</p>
                      </div>

                      <form onSubmit={handleRegister} className="space-y-6 max-w-3xl">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-xs font-bold text-gray-300 uppercase tracking-widest mb-1.5">Matrícula / ID Alumno</label>
                            <input 
                              type="text" 
                              placeholder="Ej: ALUM2026001" 
                              value={studentId}
                              onChange={(e) => setStudentId(e.target.value)}
                              className="form-input"
                              required
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-bold text-gray-300 uppercase tracking-widest mb-1.5">Nombre Completo</label>
                            <input 
                              type="text" 
                              placeholder="Ej: Juan Perez Garcia" 
                              value={fullName}
                              onChange={(e) => setFullName(e.target.value)}
                              className="form-input"
                              required
                            />
                          </div>
                        </div>

                        {/* File Upload Grids with previews */}
                        <div>
                          <label className="block text-xs font-bold text-gray-300 uppercase tracking-widest mb-3">Fotografías de Enrolamiento (Obligatorias)</label>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {/* Frontal Photo */}
                            <div className="flex flex-col items-center">
                              <span className="text-[11px] text-gray-400 font-semibold mb-1">Foto Frontal (Sin Accesorios)</span>
                              <div 
                                onClick={() => fileFrontalRef.current.click()}
                                className="w-full h-32 rounded-xl border border-dashed border-white/10 hover:border-indigo-500/50 bg-white/2 hover:bg-white/5 transition-all duration-200 cursor-pointer flex flex-col items-center justify-center overflow-hidden relative"
                              >
                                {photoPreviews.frontal ? (
                                  <img src={photoPreviews.frontal} alt="Frontal preview" className="w-full h-full object-cover" />
                                ) : (
                                  <div className="text-center p-3 text-gray-400 flex flex-col items-center gap-1.5">
                                    <svg className="w-7 h-7 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                    </svg>
                                    <span className="text-[10px] font-medium">Subir Imagen</span>
                                  </div>
                                )}
                              </div>
                              <input 
                                type="file" 
                                accept="image/*"
                                ref={fileFrontalRef}
                                onChange={(e) => handlePhotoChange('frontal', e.target.files[0])}
                                className="hidden"
                              />
                            </div>

                            {/* Accessories Photo */}
                            <div className="flex flex-col items-center">
                              <span className="text-[11px] text-gray-400 font-semibold mb-1">Foto Frontal (Con Accesorios - Lentes/Gorra)</span>
                              <div 
                                onClick={() => fileAccessoriesRef.current.click()}
                                className="w-full h-32 rounded-xl border border-dashed border-white/10 hover:border-indigo-500/50 bg-white/2 hover:bg-white/5 transition-all duration-200 cursor-pointer flex flex-col items-center justify-center overflow-hidden relative"
                              >
                                {photoPreviews.accessories ? (
                                  <img src={photoPreviews.accessories} alt="Accessories preview" className="w-full h-full object-cover" />
                                ) : (
                                  <div className="text-center p-3 text-gray-400 flex flex-col items-center gap-1.5">
                                    <svg className="w-7 h-7 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                    </svg>
                                    <span className="text-[10px] font-medium">Subir Imagen</span>
                                  </div>
                                )}
                              </div>
                              <input 
                                type="file" 
                                accept="image/*"
                                ref={fileAccessoriesRef}
                                onChange={(e) => handlePhotoChange('accessories', e.target.files[0])}
                                className="hidden"
                              />
                            </div>
                          </div>
                        </div>

                        <button 
                          type="submit" 
                          className="btn-primary px-8 py-3.5"
                          disabled={isLoading}
                        >
                          {isLoading ? (
                            <>
                              <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white inline" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                              </svg>
                              Extrayendo vectores y registrando alumno...
                            </>
                          ) : 'Registrar en Supabase'}
                        </button>
                      </form>
                    </div>
                  )}

                  {adminTab === 'students' && (
                    /* REGISTERED STUDENTS LIST */
                    <div className="flex flex-col gap-6 animate-slide-in flex-1">
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="text-lg font-bold text-white mb-1">Alumnos Registrados en el Sistema</h3>
                          <p className="text-sm text-gray-400">Total de estudiantes activos con biometría guardada en la base de datos de Supabase.</p>
                        </div>
                        <span className="text-sm bg-white/5 border border-white/10 px-3 py-1.5 rounded-lg font-bold text-indigo-300">
                          {students.length} Estudiantes
                        </span>
                      </div>

                      <div className="flex-1 overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                          <thead>
                            <tr className="border-b border-white/5 text-xs font-bold text-gray-400 uppercase tracking-widest">
                              <th className="py-3 px-4">Inicial</th>
                              <th className="py-3 px-4">Matrícula</th>
                              <th className="py-3 px-4">Nombre Completo</th>
                              <th className="py-3 px-4">Fecha de Enrolamiento</th>
                              <th className="py-3 px-4">Estado Biométrico</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-white/5">
                            {students.length === 0 ? (
                              <tr>
                                <td colSpan="5" className="py-8 text-center text-gray-500 text-sm">
                                  No hay alumnos registrados en el sistema.
                                </td>
                              </tr>
                            ) : (
                              students.map((st) => (
                                <tr key={st.id} className="hover:bg-white/2 transition-colors">
                                  <td className="py-3.5 px-4">
                                    <div className="w-8 h-8 rounded-lg bg-indigo-500/10 text-indigo-300 font-bold flex items-center justify-center text-sm border border-indigo-500/25">
                                      {st.name ? st.name.charAt(0).toUpperCase() : '?'}
                                    </div>
                                  </td>
                                  <td className="py-3.5 px-4 font-mono text-sm text-gray-300">{st.id}</td>
                                  <td className="py-3.5 px-4 font-bold text-white">{st.name}</td>
                                  <td className="py-3.5 px-4 text-sm text-gray-400">{formatDate(st.created_at)}</td>
                                  <td className="py-3.5 px-4">
                                    <span className="text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2.5 py-1 rounded font-semibold tracking-wider uppercase">
                                      128D Vector OK
                                    </span>
                                  </td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {adminTab === 'logs' && (
                    /* ATTENDANCE HISTORY & EXPORT */
                    <div className="flex flex-col gap-6 animate-slide-in flex-1">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div>
                          <h3 className="text-lg font-bold text-white mb-1">Historial General de Asistencia</h3>
                          <p className="text-sm text-gray-400">Listado detallado de todas las firmas y entradas de asistencia registradas en el servidor.</p>
                        </div>
                        <a 
                          href={`${API_BASE}/api/export`}
                          target="_blank"
                          rel="noreferrer"
                          className="btn-primary"
                        >
                          <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                          </svg>
                          Exportar a Excel
                        </a>
                      </div>

                      <div className="flex-1 overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                          <thead>
                            <tr className="border-b border-white/5 text-xs font-bold text-gray-400 uppercase tracking-widest">
                              <th className="py-3 px-4">ID Registro</th>
                              <th className="py-3 px-4">Matrícula</th>
                              <th className="py-3 px-4">Nombre Alumno</th>
                              <th className="py-3 px-4">Fecha</th>
                              <th className="py-3 px-4">Hora de Entrada</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-white/5 text-sm">
                            {logs.length === 0 ? (
                              <tr>
                                <td colSpan="5" className="py-8 text-center text-gray-500">
                                  Aún no hay logs de asistencia para mostrar.
                                </td>
                              </tr>
                            ) : (
                              logs.map((log) => (
                                <tr key={log.id} className="hover:bg-white/2 transition-colors">
                                  <td className="py-3.5 px-4 font-mono text-gray-400">#{log.id}</td>
                                  <td className="py-3.5 px-4 font-mono text-gray-300">{log.student_id}</td>
                                  <td className="py-3.5 px-4 font-bold text-white">{log.student_name}</td>
                                  <td className="py-3.5 px-4 text-gray-300">{formatDate(log.timestamp)}</td>
                                  <td className="py-3.5 px-4 font-mono font-semibold text-emerald-400">{formatTime(log.timestamp)}</td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
