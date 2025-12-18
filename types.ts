
export enum AppView {
  COURSE_LIST = 'COURSE_LIST',
  DASHBOARD = 'DASHBOARD',
  EDITOR = 'EDITOR',
  PLAYER = 'PLAYER'
}

export interface PageData {
  id: string;
  pageNumber: number;
  
  // Visuals (Stored in IndexedDB)
  // We store the keys/IDs to retrieve blobs from DB
  imageId: string | null; 
  
  // Base Content & Analysis
  aiAnalysis: string;       
  extractedText: string;    
  imageDescription: string;
  isPageAnalysisConfirmed: boolean; // New Flag: Operator has verified the AI analysis
  
  // Teacher
  teacherScript: string;
  teacherAudioId: string | null; // ID in DB
  teacherVoice: string;
  teacherAudioSpeed: number; 
  includeTeacherAudio: boolean;

  // Storyboard
  storyboardPrompt: string;
  storyboardImageId: string | null; // ID in DB
  includeStoryboard: boolean;

  // Video (Veo)
  videoPrompt: string;
  videoId: string | null; // ID in DB
  videoResolution: '720p' | '1080p';
  includeVideo: boolean;

  // Dialogue
  dialogueScript: string;
  dialogueAudioId: string | null; // ID in DB
  dialogueSpeed: number;
  includeDialogueAudio: boolean;
}

export interface CourseData {
  id: string;
  title: string;
  context: string;
  globalAnalysis: string;
  isAnalysisConfirmed: boolean;
  pages: PageData[];
}

export interface AppState {
  view: AppView;
  isLoading: boolean;
  error: string | null;
  apiKey: string | null;
  courses: CourseData[];
  activeCourseId: string | null;
  activePageIndex: number;
}
