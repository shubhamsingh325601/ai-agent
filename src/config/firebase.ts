import { initializeApp } from 'firebase/app';
import { getDatabase } from 'firebase/database';

const firebaseConfig = {
  apiKey: "AIzaSyC8LV0PyhWJdxeGB9rvpvL6HRfdkzhhEn0",
  authDomain: "fir-react-7e005.firebaseapp.com",
  projectId: "fir-react-7e005",
  storageBucket: "fir-react-7e005.firebasestorage.app",
  messagingSenderId: "397706388122",
  appId: "1:397706388122:web:20f367abae1a15c5ccb523",
  measurementId: "G-M0953D4TZQ"
};

const app = initializeApp(firebaseConfig);
export const database = getDatabase(app);