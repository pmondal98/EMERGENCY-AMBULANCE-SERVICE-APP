// Import the functions you need from the SDKs you need
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// TODO: Replace with your app's Firebase project configuration
const firebaseConfig = {
    apiKey: "AIzaSyCfS1-0eD6Qn5rXG-TSKcUsKsU_8KbG3qY",
    authDomain: "ambulanceservice-emergency.firebaseapp.com",
    projectId: "ambulanceservice-emergency",
    storageBucket: "ambulanceservice-emergency.firebasestorage.app",
    messagingSenderId: "72077627501",
    appId: "1:72077627501:web:8499ef82f5daf010a1ef64"
  };

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

export { auth, db, createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, signOut, doc, setDoc, getDoc, deleteDoc };
