
import React, { useState, useEffect, useRef } from 'react';
import { AppState, AppView, PageData, CourseData } from './types';
import { Layout } from './components/Layout';
import * as GeminiService from './services/geminiService';
import { exportToZip } from './services/exportService';
import { saveAsset, getAsset, blobToBase64, deleteAsset } from './utils/db';

const AssetDisplay = ({ assetId, type, className }: { assetId: string | null, type: 'image' | 'audio' | 'video', className?: string }) => {
    const [url, setUrl] = useState<string | null>(null);

    useEffect(() => {
        if (!assetId) { setUrl(null); return; }
        let active = true;
        
        getAsset(assetId).then(blob => {
            if (active && blob) {
                const objectUrl = URL.createObjectURL(blob);
                setUrl(objectUrl);
            }
        });

        return () => { 
            active = false; 
            if (url) URL.revokeObjectURL(url);
        };
    }, [assetId]);

    if (!assetId) return <div className="bg-slate-100 flex items-center justify-center text-xs text-slate-400 p-4 rounded h-full min-h-[100px]">بدون مدیا</div>;
    if (!url) return <div className="animate-pulse bg-slate-200 h-full min-h-[100px] rounded flex items-center justify-center text-slate-400">در حال بارگذاری...</div>;

    if (type === 'image') return <img src={url} className={className} alt="Asset" />;
    if (type === 'video') return <video controls src={url} className={className} />;
    return <audio controls src={url} className={className} />;
};

const LoadingOverlay = ({ text }: { text: string }) => (
  <div className="absolute inset-0 bg-white/90 backdrop-blur-sm z-50 flex flex-col items-center justify-center">
    <div className="w-16 h-16 border-4 border-cyan-200 border-t-cyan-600 rounded-full animate-spin mb-4"></div>
    <span className="text-slate-900 font-bold text-lg">{text}</span>
  </div>
);

const App: React.FC = () => {
  const [state, setState] = useState<AppState>({
    view: AppView.COURSE_LIST,
    isLoading: false,
    error: null,
    apiKey: null,
    courses: [],
    activeCourseId: null,
    activePageIndex: 0
  });

  const [editorTab, setEditorTab] = useState<'analysis' | 'teacher' | 'storyboard' | 'video' | 'dialogue'>('analysis');
  const [tempApiKey, setTempApiKey] = useState('');
  const [playerPageIndex, setPlayerPageIndex] = useState(0);

  // Recording State
  const [isMicReady, setIsMicReady] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    const savedKey = localStorage.getItem('gemini_api_key');
    if (savedKey) {
        const cleanKey = savedKey.replace(/[^\x20-\x7E]/g, '').trim();
        GeminiService.setApiKey(cleanKey);
        setState(prev => ({ ...prev, apiKey: cleanKey }));
    }
    
    const savedCourses = localStorage.getItem('saved_courses_meta');
    if (savedCourses) {
        try {
            const parsed = JSON.parse(savedCourses);
            setState(prev => ({ ...prev, courses: parsed }));
        } catch (e) { console.error("Failed to load courses", e); }
    }
  }, []);

  useEffect(() => {
      if (state.courses.length > 0) {
          localStorage.setItem('saved_courses_meta', JSON.stringify(state.courses));
      }
  }, [state.courses]);

  const handleLogin = () => {
      if(!tempApiKey.trim()) return;
      const cleanKey = tempApiKey.replace(/[^\x20-\x7E]/g, '').trim();
      localStorage.setItem('gemini_api_key', cleanKey);
      GeminiService.setApiKey(cleanKey);
      setState(prev => ({ ...prev, apiKey: cleanKey }));
  };

  const handleLogout = () => {
      localStorage.removeItem('gemini_api_key');
      setState(prev => ({ ...prev, apiKey: null }));
  };

  const updateState = (updates: Partial<AppState>) => setState(prev => ({ ...prev, ...updates }));
  
  const getActiveCourse = (): CourseData | null => {
    return state.courses.find(c => c.id === state.activeCourseId) || null;
  };

  const updateActiveCourse = (updates: Partial<CourseData>) => {
    setState(prev => ({
        ...prev,
        courses: prev.courses.map(c => c.id === prev.activeCourseId ? { ...c, ...updates } : c)
    }));
  };

  const updateCurrentPage = (updates: Partial<PageData>) => {
    const course = getActiveCourse();
    if (!course) return;
    
    const newPages = [...course.pages];
    newPages[state.activePageIndex] = { ...newPages[state.activePageIndex], ...updates };
    
    updateActiveCourse({ pages: newPages });
  };

  const getActivePage = () => {
      const course = getActiveCourse();
      if (!course) return null;
      return course.pages[state.activePageIndex];
  };

  const createNewCourse = () => {
      const newCourse: CourseData = {
          id: Date.now().toString(),
          title: 'درس جدید',
          context: '',
          globalAnalysis: '',
          isAnalysisConfirmed: false,
          pages: []
      };
      setState(prev => ({
          ...prev,
          courses: [...prev.courses, newCourse],
          activeCourseId: newCourse.id,
          view: AppView.DASHBOARD,
          activePageIndex: 0
      }));
  };

  const deleteCourse = (e: React.MouseEvent, courseId: string) => {
      e.stopPropagation();
      if (confirm('آیا مطمئن هستید؟ این کار تمام فایل‌های این درس را پاک می‌کند.')) {
          const course = state.courses.find(c => c.id === courseId);
          if (course) {
              course.pages.forEach(p => {
                  if (p.imageId) deleteAsset(p.imageId);
                  if (p.teacherAudioId) deleteAsset(p.teacherAudioId);
                  if (p.storyboardImageId) deleteAsset(p.storyboardImageId);
                  if (p.videoId) deleteAsset(p.videoId);
                  if (p.dialogueAudioId) deleteAsset(p.dialogueAudioId);
              });
          }

          setState(prev => ({
              ...prev,
              courses: prev.courses.filter(c => c.id !== courseId),
              activeCourseId: prev.activeCourseId === courseId ? null : prev.activeCourseId
          }));
      }
  };

  const handleAddPages = async (e: React.ChangeEvent<HTMLInputElement>) => {
     const course = getActiveCourse();
     if (!course) return;

     if (e.target.files && e.target.files.length > 0) {
         updateState({ isLoading: true, error: null });
         try {
             const newPages: PageData[] = [];
             for (let i = 0; i < e.target.files.length; i++) {
                 const file = e.target.files[i];
                 const uniqueId = `${course.id}_page_${Date.now()}_${i}`;
                 
                 await saveAsset(uniqueId, file);

                 newPages.push({
                     id: uniqueId,
                     pageNumber: course.pages.length + i + 1,
                     imageId: uniqueId,
                     
                     aiAnalysis: '',
                     extractedText: '',
                     imageDescription: '',
                     isPageAnalysisConfirmed: false,

                     teacherScript: '',
                     teacherAudioId: null,
                     teacherVoice: 'Kore',
                     teacherAudioSpeed: 1.0,
                     includeTeacherAudio: true,
                     
                     storyboardPrompt: '',
                     storyboardImageId: null,
                     includeStoryboard: true,

                     videoPrompt: '',
                     videoId: null,
                     videoResolution: '720p',
                     includeVideo: true,
                     
                     dialogueScript: '',
                     dialogueAudioId: null,
                     dialogueSpeed: 1.0,
                     includeDialogueAudio: true,
                 });
             }
             
             updateActiveCourse({ pages: [...course.pages, ...newPages] });
             updateState({ isLoading: false });
         } catch (err) {
             console.error(err);
             updateState({ error: 'خطا در بارگذاری تصاویر', isLoading: false });
         }
     }
  };

  const handleGlobalAnalysis = async () => {
     const course = getActiveCourse();
     if (!course || course.pages.length === 0) return;
     if (!course.context.trim()) {
         alert("لطفا ابتدا هدف درس را وارد کنید.");
         return;
     }
     
     updateState({ isLoading: true, error: null });
     try {
         const pagesForAI = await Promise.all(course.pages.map(async p => {
             if (p.imageId) {
                 const blob = await getAsset(p.imageId);
                 if (blob) {
                     const b64 = await blobToBase64(blob);
                     return { pageNumber: p.pageNumber, imageBase64: b64 };
                 }
             }
             return { pageNumber: p.pageNumber, imageBase64: '' };
         }));

         const analysis = await GeminiService.analyzeCourseMap(course.context, pagesForAI);
         updateActiveCourse({ globalAnalysis: analysis }); 
         updateState({ isLoading: false });
     } catch (e) {
         updateState({ isLoading: false, error: 'تحلیل انجام نشد.' });
     }
  };

  const handleExport = async () => {
    const course = getActiveCourse();
    if (!course) return;
    updateState({ isLoading: true });
    try {
        await exportToZip(course);
        updateState({ isLoading: false });
    } catch (e: any) {
        updateState({ isLoading: false, error: `خطا در اکسپورت: ${e.message}` });
    }
  };

  const getCurrentRawBase64 = async (): Promise<string> => {
      const p = getActivePage();
      if (!p || !p.imageId) throw new Error("تصویر یافت نشد");
      const blob = await getAsset(p.imageId);
      if (!blob) throw new Error("فایل تصویر در دیتابیس پیدا نشد");
      return await blobToBase64(blob);
  };

  // --- RECORDING LOGIC ---

  const prepareRecording = async () => {
      try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          const mediaRecorder = new MediaRecorder(stream);
          mediaRecorderRef.current = mediaRecorder;
          audioChunksRef.current = [];

          mediaRecorder.ondataavailable = (event) => {
              if (event.data.size > 0) audioChunksRef.current.push(event.data);
          };

          setIsMicReady(true);
      } catch (err) {
          updateState({ error: 'دسترسی به میکروفون امکان‌پذیر نیست.' });
      }
  };

  const startActualRecording = () => {
      if (mediaRecorderRef.current) {
          mediaRecorderRef.current.start();
          setIsRecording(true);
          setIsMicReady(false);
      }
  };

  const stopRecording = (type: 'teacher' | 'dialogue') => {
      if (!mediaRecorderRef.current) return;
      
      mediaRecorderRef.current.onstop = async () => {
          const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/wav' });
          const p = getActivePage();
          if (!p) return;

          const timestamp = Date.now();
          const assetId = `${p.id}_${type}_manual_${timestamp}`;
          
          await saveAsset(assetId, audioBlob);
          
          if (type === 'teacher') {
              updateCurrentPage({ teacherAudioId: assetId });
          } else {
              updateCurrentPage({ dialogueAudioId: assetId });
          }
          
          setIsRecording(false);
          setIsMicReady(false);
          // Stop all tracks to release mic
          mediaRecorderRef.current?.stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorderRef.current.stop();
  };

  const cancelPreparation = () => {
    if (mediaRecorderRef.current) {
        mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
    }
    setIsMicReady(false);
    setIsRecording(false);
  };

  // --- EDITOR HANDLERS ---

  const handlePageAnalysis = async () => {
      updateState({ isLoading: true });
      try {
          const b64 = await getCurrentRawBase64();
          const result = await GeminiService.analyzeSinglePage(b64);
          updateCurrentPage({ 
              aiAnalysis: result.analysis,
              extractedText: result.text,
              imageDescription: result.description,
              isPageAnalysisConfirmed: false 
          });
          updateState({ isLoading: false });
      } catch(e) { updateState({ isLoading: false, error: 'خطا در تحلیل' }); }
  };

  const generateTeacherContent = async () => {
      const c = getActiveCourse();
      const p = getActivePage();
      if (!c || !p) return;
      if (!p.isPageAnalysisConfirmed) {
          if(!confirm("تحلیل این صفحه هنوز تایید نشده است. ادامه می‌دهید؟")) return;
      }

      updateState({ isLoading: true });
      try {
          const b64 = await getCurrentRawBase64();
          const script = await GeminiService.generateTeacherScript(
              b64, 
              c.context, 
              p.aiAnalysis,
              p.extractedText,
              p.imageDescription
          );
          updateCurrentPage({ teacherScript: script });
          updateState({ isLoading: false });
      } catch(e) { updateState({ isLoading: false, error: 'خطا در تولید متن' }); }
  };

  const generateTeacherAudio = async () => {
      const p = getActivePage();
      if (!p || !p.teacherScript) return;
      
      updateState({ isLoading: true });
      try {
          const blob = await GeminiService.generateSpeech(p.teacherScript, p.teacherVoice, p.teacherAudioSpeed);
          const assetId = `${p.id}_teacher_${Date.now()}`;
          await saveAsset(assetId, blob);
          
          updateCurrentPage({ teacherAudioId: assetId });
          updateState({ isLoading: false });
      } catch(e) { updateState({ isLoading: false, error: 'خطا در تولید صدا' }); }
  };

  const generateStoryboardPrompt = async () => {
      const p = getActivePage();
      if (!p) return;
      if (!p.isPageAnalysisConfirmed) {
         if(!confirm("تحلیل صفحه تایید نشده. ادامه؟")) return;
      }
      updateState({ isLoading: true });
      try {
          const b64 = await getCurrentRawBase64();
          const prompt = await GeminiService.generateStoryboardPrompt(b64, p.imageDescription);
          updateCurrentPage({ storyboardPrompt: prompt });
          updateState({ isLoading: false });
      } catch(e) { updateState({ isLoading: false, error: 'خطا' }); }
  };

  const executeStoryboardGen = async () => {
      const p = getActivePage();
      if (!p || !p.storyboardPrompt) return;
      
      updateState({ isLoading: true });
      try {
          const dataUrl = await GeminiService.generateStoryboardImage(p.storyboardPrompt);
          const res = await fetch(dataUrl);
          const blob = await res.blob();
          
          const assetId = `${p.id}_storyboard_${Date.now()}`;
          await saveAsset(assetId, blob);

          updateCurrentPage({ storyboardImageId: assetId });
          updateState({ isLoading: false });
      } catch (err: any) {
          updateState({ isLoading: false, error: 'خطا در تولید تصویر' });
      }
  };

  const generateVideoPrompt = async () => {
      const p = getActivePage();
      if (!p) return;
      if (!p.isPageAnalysisConfirmed) {
         if(!confirm("تحلیل صفحه تایید نشده. ادامه؟")) return;
      }
      updateState({ isLoading: true });
      try {
          const b64 = await getCurrentRawBase64();
          const prompt = await GeminiService.generateVideoPrompt(b64, p.imageDescription);
          updateCurrentPage({ videoPrompt: prompt });
          updateState({ isLoading: false });
      } catch(e) { updateState({ isLoading: false, error: 'خطا در پرامپت ویدیو' }); }
  };

  const executeVideoGen = async () => {
      const p = getActivePage();
      if (!p || !p.videoPrompt) return;
      
      updateState({ isLoading: true });
      try {
          const b64 = await getCurrentRawBase64();
          const blob = await GeminiService.generateVideo(p.videoPrompt, b64, p.videoResolution);
          
          const assetId = `${p.id}_video_${Date.now()}`;
          await saveAsset(assetId, blob);

          updateCurrentPage({ videoId: assetId });
          updateState({ isLoading: false });
      } catch (err: any) {
          updateState({ isLoading: false, error: 'خطا در تولید ویدیو' });
      }
  };

  const generateDialogueScript = async () => {
      const p = getActivePage();
      if (!p) return;
      updateState({ isLoading: true });
      try {
          const b64 = await getCurrentRawBase64();
          const script = await GeminiService.generateDialogue(b64, p.teacherScript || "", p.extractedText);
          updateCurrentPage({ dialogueScript: script });
          updateState({ isLoading: false });
      } catch(e) { updateState({ isLoading: false, error: 'خطا' }); }
  };

  const generateDialogueAudio = async () => {
      const p = getActivePage();
      if (!p || !p.dialogueScript) return;
      
      updateState({ isLoading: true });
      try {
          const blob = await GeminiService.generateMultiSpeakerAudio(p.dialogueScript);
          const assetId = `${p.id}_dialogue_${Date.now()}`;
          await saveAsset(assetId, blob);

          updateCurrentPage({ dialogueAudioId: assetId });
          updateState({ isLoading: false });
      } catch(e) { updateState({ isLoading: false, error: 'خطا' }); }
  };


  // --- RENDERERS ---

  if (!state.apiKey) {
      return (
          <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
              <div className="bg-white p-8 rounded-2xl shadow-2xl max-w-md w-full text-right" dir="rtl">
                  <div className="text-center mb-8">
                      <h1 className="text-3xl font-bold text-slate-900 mb-2">کارخانه درس‌ساز</h1>
                      <p className="text-slate-500">پلتفرم تبدیل کتاب درسی به محتوای تعاملی</p>
                  </div>
                  <div className="space-y-4">
                      <label className="block text-sm font-bold text-slate-700">کلید API را وارد کنید:</label>
                      <input 
                          type="password" 
                          value={tempApiKey}
                          onChange={e => setTempApiKey(e.target.value)}
                          placeholder="AIzaSy..."
                          className="w-full p-4 border border-slate-300 rounded-xl bg-slate-50 focus:ring-2 focus:ring-cyan-600 outline-none text-center font-mono"
                      />
                      <button 
                          onClick={handleLogin}
                          disabled={!tempApiKey}
                          className="w-full bg-cyan-600 text-white py-4 rounded-xl font-bold text-lg hover:bg-cyan-700 disabled:opacity-50 transition-all shadow-lg shadow-cyan-200"
                      >
                          ورود 🚀
                      </button>
                  </div>
              </div>
          </div>
      );
  }

  const renderCourseList = () => (
      <div className="flex-1 p-8 overflow-y-auto">
          <div className="max-w-4xl mx-auto">
              <div className="flex justify-between items-center mb-8">
                  <h1 className="text-3xl font-bold text-slate-900">لیست درس‌ها</h1>
                  <div className="flex gap-2">
                    <button onClick={handleLogout} className="bg-slate-200 text-slate-700 px-4 py-2 rounded-lg font-bold hover:bg-slate-300">خروج</button>
                    <button onClick={createNewCourse} className="bg-cyan-600 text-white px-6 py-2 rounded-lg font-bold hover:bg-cyan-700 shadow-lg">
                        + درس جدید
                    </button>
                  </div>
              </div>

              {state.courses.length === 0 ? (
                  <div className="text-center py-20 bg-white rounded-2xl border border-dashed border-slate-300">
                      <p className="text-slate-500 mb-4">هنوز درسی نساخته‌اید.</p>
                      <button onClick={createNewCourse} className="text-cyan-600 font-bold hover:underline">اولین درس خود را بسازید</button>
                  </div>
              ) : (
                  <div className="grid md:grid-cols-2 gap-6">
                      {state.courses.map(c => (
                          <div key={c.id} className="relative bg-white p-6 rounded-xl shadow-sm border border-slate-200 hover:shadow-md transition-all group">
                              <button 
                                  onClick={(e) => deleteCourse(e, c.id)}
                                  className="absolute top-4 left-4 text-slate-300 hover:text-red-500 transition-colors p-1"
                                  title="حذف درس"
                              >
                                  🗑
                              </button>
                              <h3 className="font-bold text-xl text-slate-800 mb-2">{c.title}</h3>
                              <p className="text-slate-500 text-sm mb-4 line-clamp-2">{c.context || 'بدون توضیحات...'}</p>
                              <div className="flex justify-between items-center text-sm">
                                  <span className="bg-slate-100 text-slate-600 px-2 py-1 rounded">{c.pages.length} صفحه</span>
                                  <button 
                                      onClick={() => setState(p => ({ ...p, activeCourseId: c.id, view: AppView.DASHBOARD }))}
                                      className="text-cyan-600 font-bold hover:underline"
                                  >
                                      مدیریت درس ←
                                  </button>
                              </div>
                          </div>
                      ))}
                  </div>
              )}
          </div>
      </div>
  );

  const renderDashboard = () => {
    const course = getActiveCourse();
    if (!course) return null;

    return (
    <div className="flex-1 p-8 overflow-y-auto bg-slate-100">
        <div className="max-w-5xl mx-auto space-y-8">
            <div className="flex justify-between items-center mb-8">
                 <div className="flex items-center gap-4">
                     <button onClick={() => updateState({view: AppView.COURSE_LIST})} className="text-slate-500 hover:text-slate-800">← بازگشت</button>
                     <h1 className="text-3xl font-bold text-slate-800">داشبورد: {course.title}</h1>
                 </div>
                 {course.isAnalysisConfirmed && (
                     <button 
                         onClick={handleExport}
                         className="bg-green-600 text-white px-6 py-2 rounded-lg font-bold hover:bg-green-700 shadow flex items-center gap-2"
                     >
                         <span className="text-xl">⬇</span> خروجی نهایی (ZIP)
                     </button>
                 )}
            </div>

            <div className={`bg-white p-6 rounded-2xl shadow-sm border border-slate-200 transition-opacity ${course.isAnalysisConfirmed ? 'opacity-60' : 'opacity-100'}`}>
                <div className="flex items-center gap-3 mb-4 border-b pb-4">
                    <div className="bg-cyan-100 text-cyan-700 w-8 h-8 rounded-full flex items-center justify-center font-bold">1</div>
                    <h2 className="text-xl font-bold text-slate-900">تنظیمات اولیه</h2>
                    {course.isAnalysisConfirmed && <span className="mr-auto text-green-600 font-bold text-sm">✓ تایید شده</span>}
                </div>
                
                <div className="grid md:grid-cols-2 gap-6">
                    <div className="space-y-4">
                        <label className="block text-sm font-bold text-slate-800">عنوان درس</label>
                        <input 
                            type="text" 
                            className="w-full p-3 border border-slate-300 rounded-lg bg-white text-slate-900 focus:ring-2 focus:ring-cyan-500"
                            value={course.title}
                            disabled={course.isAnalysisConfirmed}
                            onChange={e => updateActiveCourse({ title: e.target.value })}
                        />
                        <label className="block text-sm font-bold text-slate-800">هدف یادگیری (زمینه)</label>
                        <textarea 
                            className="w-full p-3 border border-slate-300 rounded-lg h-32 bg-white text-slate-900 focus:ring-2 focus:ring-cyan-500"
                            value={course.context}
                            disabled={course.isAnalysisConfirmed}
                            onChange={e => updateActiveCourse({ context: e.target.value })}
                        />
                    </div>
                    
                    <div>
                        <label className="block text-sm font-bold text-slate-800 mb-2">صفحات کتاب</label>
                        <div className="grid grid-cols-3 gap-2 mb-4">
                            {course.pages.map((p) => (
                                <div key={p.id} className="relative aspect-[3/4] bg-slate-200 rounded border overflow-hidden">
                                    <AssetDisplay assetId={p.imageId} type="image" className="w-full h-full object-cover" />
                                    <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-xs text-center py-1">
                                        ص {p.pageNumber}
                                    </div>
                                </div>
                            ))}
                            {!course.isAnalysisConfirmed && (
                                <label className="cursor-pointer flex flex-col items-center justify-center aspect-[3/4] border-2 border-dashed border-cyan-300 rounded hover:bg-cyan-50 transition-colors bg-white">
                                    <span className="text-2xl text-cyan-500">+</span>
                                    <input type="file" multiple className="hidden" accept="image/*" onChange={handleAddPages} />
                                </label>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            <div className={`bg-white p-6 rounded-2xl shadow-sm border border-slate-200 ${course.pages.length === 0 ? 'opacity-50 grayscale pointer-events-none' : ''}`}>
                <div className="flex items-center gap-3 mb-4 border-b pb-4">
                    <div className="bg-cyan-100 text-cyan-700 w-8 h-8 rounded-full flex items-center justify-center font-bold">2</div>
                    <div className="flex-1">
                        <h2 className="text-xl font-bold text-slate-900">تحلیل جامع (نقشه راه)</h2>
                        <p className="text-xs text-slate-500">هوش مصنوعی ارتباط بین صفحات را پیدا می‌کند.</p>
                    </div>
                    {!course.isAnalysisConfirmed && (
                        <button 
                            onClick={handleGlobalAnalysis}
                            className="bg-purple-600 hover:bg-purple-700 text-white px-6 py-2 rounded-lg font-bold shadow-lg shadow-purple-200 transition-all"
                        >
                            {course.globalAnalysis ? 'تحلیل مجدد' : 'شروع تحلیل جامع'}
                        </button>
                    )}
                </div>

                {course.globalAnalysis && (
                    <div className="space-y-4 animate-fade-in">
                        <textarea 
                             className="w-full h-64 p-4 border border-slate-300 rounded-xl bg-white text-slate-900 leading-7 focus:ring-2 focus:ring-purple-500"
                             value={course.globalAnalysis}
                             disabled={course.isAnalysisConfirmed}
                             onChange={e => updateActiveCourse({ globalAnalysis: e.target.value })}
                        />
                        {!course.isAnalysisConfirmed ? (
                            <button 
                                onClick={() => updateActiveCourse({ isAnalysisConfirmed: true })}
                                className="w-full bg-green-600 text-white py-3 rounded-xl font-bold hover:bg-green-700 shadow-lg"
                            >
                                ✅ تایید و تثبیت تحلیل
                            </button>
                        ) : (
                             <div className="text-center text-green-700 font-bold bg-green-50 p-3 rounded">
                                 تحلیل تایید شد.
                                 <button onClick={() => updateActiveCourse({ isAnalysisConfirmed: false })} className="text-xs underline mr-2 text-slate-500">باز کردن قفل ویرایش</button>
                             </div>
                        )}
                    </div>
                )}
            </div>

            {course.isAnalysisConfirmed && (
                <div className="text-center pb-10 animate-fade-in">
                    <div className="inline-block bg-cyan-100 text-cyan-900 px-6 py-2 rounded-full mb-6 font-bold border border-cyan-200">
                        فاز تولید محتوا
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        {course.pages.map((p, i) => (
                            <button 
                                key={p.id}
                                onClick={() => updateState({ view: AppView.EDITOR, activePageIndex: i })}
                                className="bg-white p-4 rounded-xl shadow border hover:border-cyan-500 hover:shadow-md transition-all text-right group"
                            >
                                <div className="font-bold text-slate-900 group-hover:text-cyan-600 text-lg">صفحه {p.pageNumber}</div>
                                <div className="space-y-1 mt-2">
                                     <div className={`text-xs px-2 py-1 rounded ${p.isPageAnalysisConfirmed ? 'bg-green-100 text-green-700' : 'bg-red-50 text-red-500'}`}>{p.isPageAnalysisConfirmed ? 'تحلیل تایید شده ✓' : 'تحلیل تایید نشده ✕'}</div>
                                     <div className={`text-xs px-2 py-1 rounded ${p.teacherAudioId ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>معلم {p.teacherAudioId ? '✓' : ''}</div>
                                     <div className={`text-xs px-2 py-1 rounded ${p.storyboardImageId ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>استوری‌بورد {p.storyboardImageId ? '✓' : ''}</div>
                                     <div className={`text-xs px-2 py-1 rounded ${p.videoId ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>ویدیو {p.videoId ? '✓' : ''}</div>
                                     <div className={`text-xs px-2 py-1 rounded ${p.dialogueAudioId ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>دیالوگ {p.dialogueAudioId ? '✓' : ''}</div>
                                </div>
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    </div>
    );
  };

  const renderEditor = () => {
    const page = getActivePage();
    if (!page) return null;

    const renderRecordingButton = (type: 'teacher' | 'dialogue') => {
        if (isRecording) {
            return (
                <button 
                    onClick={() => stopRecording(type)}
                    className="w-full bg-red-600 animate-pulse text-white px-6 py-3 rounded-lg font-bold hover:bg-red-700 transition-colors shadow-md"
                >
                    توقف ضبط ⏹️
                </button>
            );
        }
        if (isMicReady) {
            return (
                <div className="flex gap-2 w-full">
                    <button 
                        onClick={startActualRecording}
                        className="flex-1 bg-red-500 text-white px-6 py-3 rounded-lg font-bold hover:bg-red-600 transition-colors shadow-md border-2 border-white"
                    >
                        حالا شروع کن 🔴
                    </button>
                    <button 
                        onClick={cancelPreparation}
                        className="bg-slate-400 text-white px-3 py-3 rounded-lg font-bold hover:bg-slate-500 transition-colors"
                        title="لغو"
                    >
                        ✕
                    </button>
                </div>
            );
        }
        return (
            <button 
                onClick={prepareRecording}
                className="w-full bg-slate-800 text-white px-6 py-3 rounded-lg font-bold hover:bg-slate-900 transition-colors shadow-md"
            >
                آماده‌سازی ضبط 🎙️
            </button>
        );
    };

    return (
        <div className="flex-1 flex flex-col h-full bg-slate-50 text-slate-900">
            <div className="bg-white border-b border-slate-200 px-6 py-3 flex justify-between items-center shadow-sm z-10">
                <div className="flex items-center gap-4">
                    <button onClick={() => updateState({ view: AppView.DASHBOARD })} className="text-slate-500 hover:text-slate-900 font-bold">
                        ← بازگشت
                    </button>
                    <h2 className="font-bold text-slate-900">میز کار: صفحه {page.pageNumber}</h2>
                </div>
                <div className="flex bg-slate-100 p-1 rounded-lg">
                    {(['analysis', 'teacher', 'storyboard', 'video', 'dialogue'] as const).map(tab => (
                        <button 
                            key={tab}
                            onClick={() => setEditorTab(tab)}
                            className={`px-4 py-2 rounded-md text-sm font-bold transition-all ${
                                editorTab === tab ? 'bg-white text-cyan-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                            }`}
                        >
                            {{
                                analysis: '۱. تحلیل و محتوا',
                                teacher: '۲. معلم', 
                                storyboard: '۳. استوری‌بورد', 
                                video: '۴. ویدیو',
                                dialogue: '۵. دیالوگ'
                            }[tab]}
                        </button>
                    ))}
                </div>
            </div>

            <div className="flex-1 flex overflow-hidden">
                <div className="w-80 bg-white border-l border-slate-200 p-4 overflow-y-auto hidden md:block shadow-inner">
                    <h3 className="text-xs font-bold text-slate-400 uppercase mb-2">تصویر مرجع</h3>
                    <AssetDisplay assetId={page.imageId} type="image" className="w-full rounded-lg shadow border border-slate-300" />
                    <div className="mt-4 p-3 bg-slate-50 rounded text-xs leading-5 text-slate-700 border border-slate-200">
                        <strong>وضعیت تحلیل:</strong><br/>
                        {page.isPageAnalysisConfirmed ? 
                            <span className="text-green-600 font-bold">تایید شده ✓</span> : 
                            <span className="text-red-500 font-bold">تایید نشده (هوش مصنوعی غیرقابل اعتماد)</span>
                        }
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-8 bg-slate-50/50">
                    <div className="max-w-3xl mx-auto bg-white rounded-2xl shadow-sm border border-slate-200 p-6 min-h-[500px]">
                        
                        {editorTab === 'analysis' && (
                             <div className="space-y-6">
                                <div className="flex justify-between items-center border-b pb-4">
                                    <h3 className="text-lg font-bold text-slate-800">تحلیل محتوا و داده‌ها (منبع حقیقت)</h3>
                                    <button 
                                        onClick={handlePageAnalysis} 
                                        className="bg-cyan-600 text-white px-4 py-2 rounded hover:bg-cyan-700 text-sm font-bold transition-colors shadow-lg shadow-cyan-200"
                                    >
                                        ✨ تحلیل مجدد با هوش مصنوعی
                                    </button>
                                </div>
                                
                                <div className="bg-yellow-50 border border-yellow-200 p-4 rounded-xl text-sm text-yellow-800 mb-4">
                                    <strong>توجه اپراتور:</strong> این بخش بسیار مهم است. تمام تولیدات بعدی (معلم، استوری‌بورد و ...) بر اساس متن‌های زیر ساخته می‌شوند. لطفاً اگر هوش مصنوعی اشتباه کرده، متن‌ها را اصلاح و سپس تایید کنید.
                                </div>

                                <div>
                                    <label className="block text-sm font-bold text-slate-700 mb-2">تحلیل آموزشی (یادداشت داخلی):</label>
                                    <textarea 
                                        className="w-full h-24 p-4 border border-slate-300 rounded-xl bg-slate-50 text-slate-900 leading-7 focus:ring-2 focus:ring-cyan-200 outline-none"
                                        value={page.aiAnalysis}
                                        onChange={e => updateCurrentPage({ aiAnalysis: e.target.value, isPageAnalysisConfirmed: false })}
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-bold text-slate-700 mb-2">متن دقیق صفحه (منبع حقیقت):</label>
                                    <textarea 
                                        className="w-full h-32 p-4 border border-slate-300 rounded-xl bg-white text-slate-900 leading-7 focus:ring-2 focus:ring-cyan-200 outline-none"
                                        value={page.extractedText}
                                        onChange={e => updateCurrentPage({ extractedText: e.target.value, isPageAnalysisConfirmed: false })}
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-bold text-slate-700 mb-2">شرح دقیق تصویر (منبع حقیقت):</label>
                                    <textarea 
                                        className="w-full h-32 p-4 border border-slate-300 rounded-xl bg-white text-slate-900 leading-7 focus:ring-2 focus:ring-cyan-200 outline-none"
                                        value={page.imageDescription}
                                        onChange={e => updateCurrentPage({ imageDescription: e.target.value, isPageAnalysisConfirmed: false })}
                                    />
                                </div>

                                <div className="pt-4 border-t border-slate-200">
                                    {!page.isPageAnalysisConfirmed ? (
                                        <button 
                                            onClick={() => updateCurrentPage({ isPageAnalysisConfirmed: true })}
                                            className="w-full bg-green-600 text-white py-4 rounded-xl font-bold text-lg hover:bg-green-700 shadow-lg shadow-green-200 transition-all flex items-center justify-center gap-2"
                                        >
                                            ✅ تایید صحت اطلاعات (قفل کردن منبع حقیقت)
                                        </button>
                                    ) : (
                                        <div className="flex items-center justify-between bg-green-50 p-4 rounded-xl border border-green-200">
                                            <span className="text-green-800 font-bold flex items-center gap-2">
                                                <span className="bg-green-200 text-green-800 w-6 h-6 rounded-full flex items-center justify-center">✓</span>
                                                اطلاعات تایید شده است.
                                            </span>
                                            <button 
                                                onClick={() => updateCurrentPage({ isPageAnalysisConfirmed: false })}
                                                className="text-sm text-slate-500 hover:text-slate-800 underline"
                                            >
                                                باز کردن قفل ویرایش
                                            </button>
                                        </div>
                                    )}
                                </div>
                             </div>
                        )}

                        {editorTab === 'teacher' && (
                            <div className="space-y-6">
                                <div className="flex justify-between items-center border-b pb-4">
                                    <h3 className="text-lg font-bold text-slate-800">استودیو معلم</h3>
                                    <button 
                                        onClick={generateTeacherContent} 
                                        className="bg-indigo-50 text-indigo-700 border border-indigo-200 px-4 py-2 rounded hover:bg-indigo-100 text-sm font-bold transition-colors"
                                    >
                                        {page.teacherScript ? 'بازنویسی متن ↺' : 'نوشتن متن با هوش مصنوعی ✨'}
                                    </button>
                                </div>
                                <textarea 
                                    className="w-full h-64 p-4 border border-slate-300 rounded-xl bg-white text-slate-900 leading-7 focus:ring-2 focus:ring-indigo-200 outline-none"
                                    value={page.teacherScript}
                                    onChange={e => updateCurrentPage({ teacherScript: e.target.value })}
                                />
                                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-4">
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="text-xs font-bold text-slate-600 block mb-1">انتخاب صدا</label>
                                            <select 
                                                value={page.teacherVoice}
                                                onChange={e => updateCurrentPage({ teacherVoice: e.target.value })}
                                                className="w-full p-2 rounded border border-slate-300 bg-white text-slate-900"
                                            >
                                                <option value="Kore">خانم (Kore)</option>
                                                <option value="Fenrir">آقا (Fenrir)</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label className="text-xs font-bold text-slate-600 block mb-1">سرعت پخش: {page.teacherAudioSpeed}x</label>
                                            <input 
                                                type="range" min="0.5" max="2.0" step="0.1"
                                                value={page.teacherAudioSpeed}
                                                onChange={e => updateCurrentPage({ teacherAudioSpeed: parseFloat(e.target.value) })}
                                                className="w-full mt-2"
                                            />
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
                                        <button 
                                            onClick={generateTeacherAudio}
                                            disabled={!page.teacherScript || isRecording || isMicReady}
                                            className="w-full bg-indigo-600 text-white px-6 py-3 rounded-lg font-bold hover:bg-indigo-700 disabled:bg-slate-300 transition-colors shadow-md"
                                        >
                                            تولید صدا (AI) 🔊
                                        </button>
                                        {renderRecordingButton('teacher')}
                                    </div>
                                </div>
                                {page.teacherAudioId && (
                                    <div className="bg-green-50 border border-green-200 p-4 rounded-lg flex flex-col gap-3">
                                        <div className="flex items-center gap-3">
                                            <div className="bg-green-100 p-2 rounded-full">✅</div>
                                            <AssetDisplay assetId={page.teacherAudioId} type="audio" className="w-full h-10" />
                                        </div>
                                        <label className="flex items-center gap-2 pt-2 border-t border-green-200 cursor-pointer">
                                            <input 
                                                type="checkbox" 
                                                checked={page.includeTeacherAudio} 
                                                onChange={e => updateCurrentPage({ includeTeacherAudio: e.target.checked })}
                                                className="w-4 h-4 text-green-600 rounded focus:ring-green-500"
                                            />
                                            <span className="text-xs font-bold text-green-800">اعمال در فایل خروجی نهایی</span>
                                        </label>
                                    </div>
                                )}
                            </div>
                        )}

                        {editorTab === 'storyboard' && (
                            <div className="space-y-6">
                                <div className="flex justify-between items-center border-b pb-4">
                                    <h3 className="text-lg font-bold text-slate-800">استودیو استوری‌بورد</h3>
                                    <button 
                                        onClick={generateStoryboardPrompt}
                                        className="bg-pink-50 text-pink-700 border border-pink-200 px-4 py-2 rounded hover:bg-pink-100 text-sm font-bold transition-colors"
                                    >
                                        {page.storyboardPrompt ? 'بازنویسی پرامپت ↺' : 'پیشنهاد پرامپت (فارسی) ✨'}
                                    </button>
                                </div>
                                <div className="space-y-2">
                                    <label className="text-sm font-bold text-slate-700">توصیف تصویر:</label>
                                    <textarea 
                                        className="w-full h-32 p-4 border border-slate-300 rounded-xl bg-white text-slate-900 font-normal text-sm focus:ring-2 focus:ring-pink-200 outline-none"
                                        value={page.storyboardPrompt}
                                        onChange={e => updateCurrentPage({ storyboardPrompt: e.target.value })}
                                        placeholder="هوش مصنوعی صحنه را توصیف خواهد کرد..."
                                    />
                                </div>
                                <button 
                                    onClick={executeStoryboardGen}
                                    disabled={!page.storyboardPrompt}
                                    className="w-full bg-pink-600 text-white py-4 rounded-xl font-bold hover:bg-pink-700 shadow-lg shadow-pink-200 disabled:bg-slate-300 transition-colors"
                                >
                                    ساخت تصویر استوری‌بورد 🎨
                                </button>
                                {page.storyboardImageId && (
                                    <div className="mt-6">
                                        <label className="text-sm font-bold text-slate-700 block mb-2">تصویر تولید شده:</label>
                                        <AssetDisplay assetId={page.storyboardImageId} type="image" className="w-full rounded-xl shadow-lg border border-slate-200" />
                                        <label className="flex items-center gap-2 mt-2 pt-2 cursor-pointer bg-slate-50 p-2 rounded border border-slate-200">
                                            <input 
                                                type="checkbox" 
                                                checked={page.includeStoryboard} 
                                                onChange={e => updateCurrentPage({ includeStoryboard: e.target.checked })}
                                                className="w-4 h-4 text-pink-600 rounded focus:ring-pink-500"
                                            />
                                            <span className="text-xs font-bold text-slate-700">اعمال در فایل خروجی نهایی</span>
                                        </label>
                                    </div>
                                )}
                            </div>
                        )}

                        {editorTab === 'video' && (
                             <div className="space-y-6">
                                <div className="flex justify-between items-center border-b pb-4">
                                    <h3 className="text-lg font-bold text-slate-800">استودیو ویدیو (Veo)</h3>
                                    <button 
                                        onClick={generateVideoPrompt}
                                        className="bg-orange-50 text-orange-700 border border-orange-200 px-4 py-2 rounded hover:bg-orange-100 text-sm font-bold transition-colors"
                                    >
                                        {page.videoPrompt ? 'بازنویسی پرامپت ↺' : 'پیشنهاد پرامپت ویدیو (فارسی) ✨'}
                                    </button>
                                </div>

                                <div className="bg-orange-50 p-3 rounded-lg border border-orange-100 flex items-center gap-4">
                                    <label className="text-sm font-bold text-orange-800">کیفیت ویدیو:</label>
                                    <select 
                                        value={page.videoResolution}
                                        onChange={e => updateCurrentPage({ videoResolution: e.target.value as '720p' | '1080p' })}
                                        className="p-2 rounded border border-orange-200 text-sm font-bold bg-white text-slate-800 focus:ring-2 focus:ring-orange-300 outline-none"
                                    >
                                        <option value="720p">HD (720p) - سریع‌تر</option>
                                        <option value="1080p">Full HD (1080p) - کیفیت بالاتر</option>
                                    </select>
                                </div>

                                <textarea 
                                    className="w-full h-32 p-4 border border-slate-300 rounded-xl bg-white text-slate-900 font-normal text-sm focus:ring-2 focus:ring-orange-200 outline-none"
                                    value={page.videoPrompt}
                                    onChange={e => updateCurrentPage({ videoPrompt: e.target.value })}
                                    placeholder="توصیف صحنه ویدیو به فارسی..."
                                />
                                <button 
                                    onClick={executeVideoGen}
                                    disabled={!page.videoPrompt}
                                    className="w-full bg-orange-600 text-white py-4 rounded-xl font-bold hover:bg-orange-700 shadow-lg shadow-orange-200 disabled:bg-slate-300 transition-colors"
                                >
                                    ساخت ویدیو با Veo 🎬
                                </button>
                                {page.videoId && (
                                    <div className="mt-6">
                                        <label className="text-sm font-bold text-slate-700 block mb-2">ویدیو خروجی:</label>
                                        <AssetDisplay assetId={page.videoId} type="video" className="w-full rounded-lg" />
                                        <label className="flex items-center gap-2 mt-2 pt-2 cursor-pointer bg-slate-50 p-2 rounded border border-slate-200">
                                            <input 
                                                type="checkbox" 
                                                checked={page.includeVideo} 
                                                onChange={e => updateCurrentPage({ includeVideo: e.target.checked })}
                                                className="w-4 h-4 text-orange-600 rounded focus:ring-orange-500"
                                            />
                                            <span className="text-xs font-bold text-slate-700">اعمال در فایل خروجی نهایی</span>
                                        </label>
                                    </div>
                                )}
                            </div>
                        )}

                        {editorTab === 'dialogue' && (
                             <div className="space-y-6">
                                <div className="flex justify-between items-center border-b pb-4">
                                    <h3 className="text-lg font-bold text-slate-800">استودیو دیالوگ</h3>
                                    <button 
                                        onClick={generateDialogueScript} 
                                        className="bg-teal-50 text-teal-700 border border-teal-200 px-4 py-2 rounded hover:bg-teal-100 text-sm font-bold transition-colors"
                                    >
                                        {page.dialogueScript ? 'بازنویسی ↺' : 'نوشتن سناریو با هوش مصنوعی ✨'}
                                    </button>
                                </div>
                                <textarea 
                                    className="w-full h-64 p-4 border border-slate-300 rounded-xl bg-white text-slate-900 leading-7 focus:ring-2 focus:ring-teal-200 outline-none"
                                    value={page.dialogueScript}
                                    onChange={e => updateCurrentPage({ dialogueScript: e.target.value })}
                                />
                                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-4">
                                    <div>
                                         <label className="text-xs font-bold text-slate-600 block mb-1">سرعت پخش: {page.dialogueSpeed || 1.0}x</label>
                                         <input 
                                             type="range" min="0.5" max="2.0" step="0.1"
                                             value={page.dialogueSpeed || 1.0}
                                             onChange={e => updateCurrentPage({ dialogueSpeed: parseFloat(e.target.value) })}
                                             className="w-full mt-2"
                                         />
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
                                        <button 
                                            onClick={generateDialogueAudio}
                                            disabled={!page.dialogueScript || isRecording || isMicReady}
                                            className="w-full bg-teal-600 text-white px-6 py-3 rounded-lg font-bold hover:bg-teal-700 disabled:bg-slate-300 transition-colors shadow-md"
                                        >
                                            تولید صدای هوشمند 🗣️
                                        </button>
                                        {renderRecordingButton('dialogue')}
                                    </div>
                                </div>
                                {page.dialogueAudioId && (
                                    <div className="bg-green-50 border border-green-200 p-4 rounded-lg flex flex-col gap-3">
                                        <div className="flex items-center gap-3">
                                            <div className="bg-green-100 p-2 rounded-full">✅</div>
                                            <AssetDisplay assetId={page.dialogueAudioId} type="audio" className="w-full h-10" />
                                        </div>
                                        <label className="flex items-center gap-2 pt-2 border-t border-green-200 cursor-pointer">
                                            <input 
                                                type="checkbox" 
                                                checked={page.includeDialogueAudio} 
                                                onChange={e => updateCurrentPage({ includeDialogueAudio: e.target.checked })}
                                                className="w-4 h-4 text-green-600 rounded focus:ring-green-500"
                                            />
                                            <span className="text-xs font-bold text-green-800">اعمال در فایل خروجی نهایی</span>
                                        </label>
                                    </div>
                                )}
                             </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
  };

  const renderPlayer = () => {
      const course = getActiveCourse();
      if (!course) return null;
      const page = course.pages[playerPageIndex];
      if (!page) return null;

      return (
          <div className="h-full bg-slate-100 flex items-center justify-center p-4">
              <div className="w-full max-w-md bg-white h-full rounded-2xl shadow-2xl overflow-hidden flex flex-col relative border border-slate-300">
                  <div className="bg-cyan-700 text-white p-4 flex justify-between items-center z-10 shadow-md">
                      <button disabled={playerPageIndex === 0} onClick={() => setPlayerPageIndex(p => p - 1)} className="disabled:opacity-50 font-bold text-sm">قبلی</button>
                      <span className="font-bold text-sm">{course.title} - صفحه {playerPageIndex + 1}</span>
                      <button disabled={playerPageIndex === course.pages.length - 1} onClick={() => setPlayerPageIndex(p => p + 1)} className="disabled:opacity-50 font-bold text-sm">بعدی</button>
                  </div>

                  <div className="flex-1 overflow-y-auto p-4 space-y-6">
                      <AssetDisplay assetId={page.imageId} type="image" className="w-full rounded-lg shadow-sm border border-slate-200" />
                      
                      {page.teacherAudioId && (
                          <div className="bg-indigo-50 border border-indigo-100 p-3 rounded-xl flex flex-col gap-2">
                              <div className="flex items-center gap-2">
                                  <div className="w-8 h-8 bg-indigo-600 rounded-full flex items-center justify-center text-white text-xs">🔊</div>
                                  <span className="text-xs font-bold text-indigo-900">توضیحات معلم</span>
                              </div>
                              <AssetDisplay assetId={page.teacherAudioId} type="audio" />
                          </div>
                      )}

                      {page.storyboardImageId && (
                          <div className="rounded-xl overflow-hidden border-4 border-white shadow-lg relative">
                              <AssetDisplay assetId={page.storyboardImageId} type="image" className="w-full object-cover" />
                          </div>
                      )}

                      {page.videoId && (
                          <div className="rounded-xl overflow-hidden border-4 border-white shadow-lg relative">
                               <div className="bg-black text-white text-xs p-1 absolute top-0 right-0 z-10">ویدیوی آموزشی</div>
                               <AssetDisplay assetId={page.videoId} type="video" />
                          </div>
                      )}

                      {page.dialogueAudioId && (
                          <div className="bg-teal-50 border border-teal-100 p-3 rounded-xl flex flex-col gap-2">
                              <div className="flex items-center gap-2">
                                  <div className="w-8 h-8 bg-teal-600 rounded-full flex items-center justify-center text-white text-xs">🗣️</div>
                                  <span className="text-xs font-bold text-teal-900">گفتگوی کلاسی</span>
                              </div>
                              <AssetDisplay assetId={page.dialogueAudioId} type="audio" />
                          </div>
                      )}
                  </div>
                  
                  <button onClick={() => updateState({ view: AppView.DASHBOARD })} className="absolute bottom-4 left-4 bg-black/60 backdrop-blur text-white text-xs px-3 py-1 rounded-full hover:bg-black/80 transition">خروج</button>
              </div>
          </div>
      );
  };

  return (
    <Layout 
        view={state.view} 
        activeCourse={getActiveCourse()}
        activePageIndex={state.activePageIndex}
        onNavigate={(v, idx) => updateState({ view: v, activePageIndex: idx !== undefined ? idx : state.activePageIndex })}
        onBackToCourses={() => updateState({ view: AppView.COURSE_LIST, activeCourseId: null })}
    >
        {state.isLoading && <LoadingOverlay text="در حال پردازش..." />}
        {state.error && (
            <div className="absolute top-0 left-0 right-0 bg-red-500 text-white text-center p-3 z-[60] flex justify-between px-8 shadow-lg" dir="rtl">
                <span className="font-bold text-sm">{state.error}</span>
                <button onClick={() => updateState({error: null})}>✕</button>
            </div>
        )}

        {state.view === AppView.COURSE_LIST && renderCourseList()}
        {state.view === AppView.DASHBOARD && renderDashboard()}
        {state.view === AppView.EDITOR && renderEditor()}
        {state.view === AppView.PLAYER && renderPlayer()}
    </Layout>
  );
};

export default App;
