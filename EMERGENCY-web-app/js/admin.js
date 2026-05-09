import { auth, db, createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, signOut, doc, setDoc, getDoc, deleteDoc } from './firebase-config.js';

document.addEventListener('DOMContentLoaded', () => {
    // --- Auth Logic ---
    const authSection = document.getElementById('auth-section');
    const mainApp = document.getElementById('main-app');
    const authForm = document.getElementById('auth-form');
    const authEmail = document.getElementById('auth-email');
    const authPassword = document.getElementById('auth-password');
    const authError = document.getElementById('auth-error');
    const btnToggleAuth = document.getElementById('btn-toggle-auth');
    const authTitle = document.getElementById('auth-title');
    const authSubtitle = document.getElementById('auth-subtitle');
    const authToggleText = document.getElementById('auth-toggle-text');
    const authSubmitBtn = document.getElementById('auth-submit-btn');
    const btnLogout = document.getElementById('btn-logout');
    
    // New fields
    const registerFields = document.getElementById('register-fields');
    const authName = document.getElementById('auth-name');
    const authAmbulancePlate = document.getElementById('auth-ambulance-plate');
    const authAmbulanceType = document.getElementById('auth-ambulance-type');

    let isLoginMode = true;
    let currentUserProfile = null; // Store fetched firestore profile

    btnToggleAuth.addEventListener('click', () => {
        isLoginMode = !isLoginMode;
        authError.classList.add('hidden');
        if (isLoginMode) {
            authTitle.textContent = 'Driver Login';
            authSubtitle.textContent = 'Sign in to start receiving requests';
            authSubmitBtn.textContent = 'Login';
            authToggleText.textContent = "Don't have a driver account?";
            btnToggleAuth.textContent = 'Register';
            registerFields.classList.add('hidden');
            authName.removeAttribute('required');
            authAmbulancePlate.removeAttribute('required');
            authAmbulanceType.removeAttribute('required');
        } else {
            authTitle.textContent = 'Driver Registration';
            authSubtitle.textContent = 'Register to become an ambulance driver';
            authSubmitBtn.textContent = 'Register';
            authToggleText.textContent = "Already have a driver account?";
            btnToggleAuth.textContent = 'Login';
            registerFields.classList.remove('hidden');
            authName.setAttribute('required', 'true');
            authAmbulancePlate.setAttribute('required', 'true');
            authAmbulanceType.setAttribute('required', 'true');
        }
    });

    authForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        authError.classList.add('hidden');
        authSubmitBtn.disabled = true;
        authSubmitBtn.textContent = 'Processing...';

        const email = authEmail.value;
        const password = authPassword.value;

        try {
            if (isLoginMode) {
                await signInWithEmailAndPassword(auth, email, password);
            } else {
                const name = authName.value;
                const plate = authAmbulancePlate.value;
                const type = authAmbulanceType.value;
                
                // 1. Create Auth User
                const userCredential = await createUserWithEmailAndPassword(auth, email, password);
                const user = userCredential.user;
                
                // 2. Save Driver Profile to Firestore
                await setDoc(doc(db, "drivers", user.uid), {
                    name: name,
                    licensePlate: plate,
                    ambulanceType: type,
                    email: email,
                    createdAt: new Date().getTime()
                });
            }
        } catch (error) {
            authError.textContent = error.message;
            authError.classList.remove('hidden');
        } finally {
            authSubmitBtn.disabled = false;
            authSubmitBtn.textContent = isLoginMode ? 'Login' : 'Register';
        }
    });

    btnLogout.addEventListener('click', () => {
        signOut(auth);
    });

    // Listen for auth state changes
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            // Fetch Driver Profile from Firestore
            try {
                const docRef = doc(db, "drivers", user.uid);
                const docSnap = await getDoc(docRef);
                
                if (docSnap.exists()) {
                    currentUserProfile = docSnap.data();
                } else {
                    currentUserProfile = { name: "Unknown Driver", licensePlate: "Unknown Plate", ambulanceType: "Unknown Type", email: user.email };
                }
            } catch (err) {
                console.error("Error fetching driver profile", err);
                currentUserProfile = { name: "Driver", licensePlate: "Unknown", ambulanceType: "Ambulance", email: user.email };
            }

            // User is signed in
            authSection.classList.add('hidden');
            mainApp.classList.remove('hidden');
            
            const btnLogoutEl = document.getElementById('btn-logout');
            btnLogoutEl.classList.remove('hidden');
            btnLogoutEl.style.display = 'inline-block';
            
            const btnToggleStatusEl = document.getElementById('btn-toggle-status');
            btnToggleStatusEl.classList.remove('hidden');
            btnToggleStatusEl.style.display = 'inline-block';
            
            const driverStatusEl = document.getElementById('driver-status');
            driverStatusEl.classList.remove('hidden');
            driverStatusEl.style.display = 'inline-flex';
            
            if (!map) {
                requestLocationAndInitMap();
            }
        } else {
            // User is signed out
            currentUserProfile = null;
            authSection.classList.remove('hidden');
            mainApp.classList.add('hidden');
            
            const btnLogoutEl = document.getElementById('btn-logout');
            btnLogoutEl.classList.add('hidden');
            btnLogoutEl.style.display = 'none';
            
            const btnToggleStatusEl = document.getElementById('btn-toggle-status');
            btnToggleStatusEl.classList.add('hidden');
            btnToggleStatusEl.style.display = 'none';
            
            const driverStatusEl = document.getElementById('driver-status');
            driverStatusEl.classList.add('hidden');
            driverStatusEl.style.display = 'none';
            
            // Force offline if logged out while online
            if (isOnline) {
                document.getElementById('btn-toggle-status').click();
            }
        }
    });


    // --- Map and Tracking Logic ---
    let map = null;
    let driverMarker;
    let requestMarker;
    let routeLine;
    let driverLocation = null;
    let isOnline = false;
    let activeRequest = null;
    let requestCheckInterval;
    let driveInterval;

    const mapLoading = document.getElementById('map-loading');
    const btnToggleStatus = document.getElementById('btn-toggle-status');
    const btnRefreshLocation = document.getElementById('btn-refresh-location');
    const driverStatus = document.getElementById('driver-status');
    const requestsContainer = document.getElementById('requests-container');

    function initMap(lat, lng) {
        driverLocation = [lat,  lng]; 
        map = L.map('map').setView(driverLocation, 14);
        
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '© OpenStreetMap'
        }).addTo(map);

        const ambulanceIcon = L.divIcon({
            className: 'custom-div-icon',
            html: "<div style='background-color:#10b981; width:20px; height:20px; border-radius:50%; display:flex; align-items:center; justify-content:center; color:white; font-size:10px; box-shadow:0 0 10px rgba(16,185,129,0.5);'><i class='fa-solid fa-plus'></i></div>",
            iconSize: [20, 20],
            iconAnchor: [10, 10]
        });

        driverMarker = L.marker(driverLocation, {icon: ambulanceIcon}).addTo(map)
            .bindPopup("Your Ambulance").openPopup();
            
        mapLoading.classList.add('hidden');
    }

    let locationWatchId = null;

    function requestLocationAndInitMap() {
        mapLoading.classList.remove('hidden');
        if (navigator.geolocation) {
            if (locationWatchId) navigator.geolocation.clearWatch(locationWatchId);
            
            locationWatchId = navigator.geolocation.watchPosition(
                async (position) => {
                    const newLocation = [position.coords.latitude, position.coords.longitude];
                    
                    if (!map) {
                        initMap(newLocation[0], newLocation[1]);
                    } else {
                        driverLocation = newLocation;
                        driverMarker.setLatLng(driverLocation);
                        mapLoading.classList.add('hidden');
                    }
                    
                    // If online but idle, update online_drivers
                    if (isOnline && !activeRequest) {
                        broadcastDriverLocation(true);
                    }
                    
                    // If on active mission, update emergency_request
                    if (activeRequest) {
                        try {
                            const reqSnap = await getDoc(doc(db, "system", "emergency_request"));
                            if (reqSnap.exists()) {
                                const req = reqSnap.data();
                                req.driverLocation = driverLocation;
                                await setDoc(doc(db, "system", "emergency_request"), req);
                            }
                        } catch(e) {
                            console.error("Failed to update driver location on mission", e);
                        }
                    }
                },
                (error) => {
                    if (!map) initMap(40.7128, -74.0060);
                    else mapLoading.classList.add('hidden');
                    console.error("Location error:", error);
                },
                { enableHighAccuracy: true, maximumAge: 10000, timeout: 5000 }
            );
        } else {
            if (!map) initMap(40.7128, -74.0060);
            else mapLoading.classList.add('hidden');
        }
    }

    btnRefreshLocation.addEventListener('click', () => {
        if (map && driverLocation) {
            map.setView(driverLocation, 14);
        }
    });

    btnToggleStatus.addEventListener('click', () => {
        isOnline = !isOnline;
        if (isOnline) {
            btnToggleStatus.textContent = "Go Offline";
            btnToggleStatus.className = "btn btn-secondary";
            driverStatus.className = "status-badge status-searching";
            driverStatus.textContent = "Online";
            startListeningForRequests();
            broadcastDriverLocation(true);
        } else {
            btnToggleStatus.textContent = "Go Online";
            btnToggleStatus.className = "btn btn-success";
            driverStatus.className = "status-badge status-idle";
            driverStatus.textContent = "Offline";
            stopListeningForRequests();
            broadcastDriverLocation(false);
        }
    });

    async function broadcastDriverLocation(isAvailable) {
        try {
            let drivers = {};
            const driversSnap = await getDoc(doc(db, "system", "online_drivers"));
            if (driversSnap.exists()) {
                drivers = driversSnap.data();
            }

            const driverId = auth.currentUser ? auth.currentUser.uid : 'temp_driver';
            
            if (isAvailable && driverLocation) {
                drivers[driverId] = {
                    location: driverLocation,
                    profile: currentUserProfile,
                    timestamp: new Date().getTime()
                };
            } else {
                delete drivers[driverId];
            }
            await setDoc(doc(db, "system", "online_drivers"), drivers);
        } catch (error) {
            console.error("Error broadcasting location:", error);
        }
    }

    function startListeningForRequests() {
        renderRequests(); 
        requestCheckInterval = setInterval(renderRequests, 2000);
    }

    function stopListeningForRequests() {
        if (requestCheckInterval) clearInterval(requestCheckInterval);
        requestsContainer.innerHTML = `
            <div class="request-card" style="text-align: center; border: 1px dashed var(--border-color); background: transparent; padding: 2rem 1rem;">
                <i class="fa-solid fa-power-off" style="font-size: 2rem; color: var(--text-secondary); margin-bottom: 1rem;"></i>
                <p>You are offline.</p>
            </div>
        `;
    }

    async function renderRequests() {
        if (activeRequest) return; 

        // Optimistically show waiting state if coming from offline
        if (requestsContainer.innerHTML.includes('You are offline')) {
            requestsContainer.innerHTML = `
                <div class="request-card" style="text-align: center; border: 1px dashed var(--border-color); background: transparent; padding: 2rem 1rem;">
                    <i class="fa-solid fa-satellite-dish" style="font-size: 2rem; color: var(--text-secondary); margin-bottom: 1rem;"></i>
                    <p>Waiting for incoming requests...</p>
                </div>
            `;
        }

        try {
            const reqSnap = await getDoc(doc(db, "system", "emergency_request"));
            if (!reqSnap.exists()) {
                requestsContainer.innerHTML = `
                    <div class="request-card" style="text-align: center; border: 1px dashed var(--border-color); background: transparent; padding: 2rem 1rem;">
                        <i class="fa-solid fa-satellite-dish" style="font-size: 2rem; color: var(--text-secondary); margin-bottom: 1rem;"></i>
                        <p>Waiting for incoming requests...</p>
                    </div>
                `;
                if (requestMarker) { map.removeLayer(requestMarker); requestMarker = null; }
                return;
            }

            const req = reqSnap.data();
        if (req.status === 'searching') {
            requestsContainer.innerHTML = `
                <div class="request-card pulse">
                    <h3><i class="fa-solid fa-bell" style="color:var(--primary-color);"></i> New Emergency: ${req.type}</h3>
                    <p>User: ${req.userEmail || 'Anonymous'}</p>
                    <p>Distance: ~2.5 km</p>
                    <div class="actions">
                        <button class="btn btn-primary" onclick="acceptRequest('${req.id}')" style="flex: 1;">Accept</button>
                    </div>
                </div>
            `;

            if (!requestMarker) {
                const userIcon = L.divIcon({
                    className: 'custom-div-icon pulse',
                    html: "<div style='background-color:#ef4444; width:15px; height:15px; border-radius:50%; border:2px solid white;'></div>",
                    iconSize: [15, 15]
                });
                requestMarker = L.marker(req.location, {icon: userIcon}).addTo(map)
                    .bindPopup("Emergency Location").openPopup();
                
                const bounds = L.latLngBounds([driverLocation, req.location]);
                map.fitBounds(bounds, {padding: [50, 50]});
            }
            }
        } catch (error) {
            console.error("Error fetching requests:", error);
            
            // Fix visual mismatch by clicking the button to toggle offline state
            if (isOnline) {
                const btnToggle = document.getElementById('btn-toggle-status');
                isOnline = false;
                btnToggle.textContent = "Go Online";
                btnToggle.className = "btn btn-success";
                const driverStatus = document.getElementById('driver-status');
                driverStatus.className = "status-badge status-idle";
                driverStatus.textContent = "Offline";
                if (requestCheckInterval) clearInterval(requestCheckInterval);
            }

            requestsContainer.innerHTML = `
                <div class="request-card" style="text-align: center; border: 1px dashed var(--border-color); background: transparent; padding: 2rem 1rem; color: #ef4444;">
                    <i class="fa-solid fa-triangle-exclamation" style="font-size: 2rem; margin-bottom: 1rem;"></i>
                    <p>Error connecting to server.</p>
                    <p style="font-size: 0.85rem; margin-top: 0.5rem; color: var(--text-secondary);">Firebase Permission Denied. You must update your Firestore Security Rules in the Firebase Console to allow reading from the "system" collection.</p>
                </div>
            `;
        }
    }

    window.acceptRequest = async function(id) {
        const reqSnap = await getDoc(doc(db, "system", "emergency_request"));
        if (!reqSnap.exists()) return;

        const req = reqSnap.data();
        if (req.id === id) {
            activeRequest = req;
            req.status = 'accepted';
            // Use real Firestore data to broadcast to user
            req.driverName = `${currentUserProfile.name} - ${currentUserProfile.ambulanceType} (${currentUserProfile.licensePlate})`; 
            req.driverLocation = driverLocation;
            await setDoc(doc(db, "system", "emergency_request"), req);

            // Remove from available idle drivers since now on mission
            broadcastDriverLocation(false);

            requestsContainer.innerHTML = `
                <div class="request-card" style="border-left: 4px solid #10b981;">
                    <h3><i class="fa-solid fa-truck-medical"></i> En Route</h3>
                    <p>Emergency: ${req.type}</p>
                    <p>User: ${req.userEmail || 'Anonymous'}</p>
                    <div class="actions">
                        <button class="btn btn-success" onclick="completeRequest()" style="flex: 1;">Mark Completed</button>
                    </div>
                </div>
            `;

            driverStatus.className = "status-badge status-accepted";
            driverStatus.textContent = "On Mission";

            // Draw route line to target but do NOT fake simulate movement
            if (routeLine) map.removeLayer(routeLine);
            routeLine = L.polyline([driverLocation, req.location], {color: '#3b82f6', weight: 4, dashArray: '5, 10'}).addTo(map);
        }
    };

    window.completeRequest = async function() {
        await deleteDoc(doc(db, "system", "emergency_request"));
        activeRequest = null;
        if (driveInterval) clearInterval(driveInterval);
        
        if (requestMarker) { map.removeLayer(requestMarker); requestMarker = null; }
        if (routeLine) { map.removeLayer(routeLine); routeLine = null; }
        
        driverStatus.className = "status-badge status-searching";
        driverStatus.textContent = "Online";
        renderRequests();
        map.setView(driverLocation, 14);
        
        // Re-broadcast as available
        broadcastDriverLocation(true);
        
        alert("Mission Completed successfully.");
    };
});
