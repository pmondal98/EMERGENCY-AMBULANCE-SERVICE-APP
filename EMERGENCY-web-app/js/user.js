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
    const userEmailSpan = document.getElementById('user-email');

    let isLoginMode = true;

    btnToggleAuth.addEventListener('click', () => {
        isLoginMode = !isLoginMode;
        authError.classList.add('hidden');
        if (isLoginMode) {
            authTitle.textContent = 'User Login';
            authSubtitle.textContent = 'Sign in to book an ambulance';
            authSubmitBtn.textContent = 'Login';
            authToggleText.textContent = "Don't have an account?";
            btnToggleAuth.textContent = 'Register';
        } else {
            authTitle.textContent = 'User Registration';
            authSubtitle.textContent = 'Create an account to get started';
            authSubmitBtn.textContent = 'Register';
            authToggleText.textContent = "Already have an account?";
            btnToggleAuth.textContent = 'Login';
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
                await createUserWithEmailAndPassword(auth, email, password);
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
    onAuthStateChanged(auth, (user) => {
        if (user) {
            // User is signed in
            authSection.classList.add('hidden');
            mainApp.classList.remove('hidden');
            btnLogout.classList.remove('hidden');
            userEmailSpan.textContent = user.email;
            // Initialize map if not already done
            if (!map) {
                requestLocationAndInitMap();
            }
        } else {
            // User is signed out
            authSection.classList.remove('hidden');
            mainApp.classList.add('hidden');
            btnLogout.classList.add('hidden');
            userEmailSpan.textContent = 'User Portal';
        }
    });

    // --- Map Initialization ---
    let map = null;
    let userMarker;
    let driverMarker;
    let routeLine;
    let userLocation = null;
    let idleAmbulanceMarkers = {}; // Store markers by driverId
    let idlePollingInterval = null;

    const mapLoading = document.getElementById('map-loading');
    
    function initMap(lat, lng) {
        userLocation = [lat, lng];
        map = L.map('map').setView(userLocation, 15);
        
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '© OpenStreetMap'
        }).addTo(map);

        const userIcon = L.divIcon({
            className: 'custom-div-icon',
            html: "<div style='background-color:#3b82f6; width:15px; height:15px; border-radius:50%; border:3px solid white; box-shadow:0 0 10px rgba(0,0,0,0.5);'></div>",
            iconSize: [15, 15],
            iconAnchor: [7.5, 7.5]
        });

        userMarker = L.marker(userLocation, {icon: userIcon}).addTo(map)
            .bindPopup("Your Location")
            .openPopup();
            
        mapLoading.classList.add('hidden');
        document.getElementById('pickup-location').value = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    }

    function requestLocationAndInitMap() {
        mapLoading.classList.remove('hidden');
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
                (position) => { 
                    if (!map) {
                        initMap(position.coords.latitude, position.coords.longitude); 
                        startPollingIdleDrivers(); 
                    } else {
                        userLocation = [position.coords.latitude, position.coords.longitude];
                        userMarker.setLatLng(userLocation);
                        map.setView(userLocation, 15);
                        document.getElementById('pickup-location').value = `${position.coords.latitude.toFixed(4)}, ${position.coords.longitude.toFixed(4)}`;
                        mapLoading.classList.add('hidden');
                    }
                },
                (error) => { 
                    if (!map) {
                        initMap(40.7128, -74.0060); 
                        document.getElementById('pickup-location').value = "Location access denied. Using default."; 
                        startPollingIdleDrivers(); 
                    } else {
                        mapLoading.classList.add('hidden');
                    }
                }
            );
        } else {
            if (!map) {
                initMap(40.7128, -74.0060);
                startPollingIdleDrivers();
            } else {
                mapLoading.classList.add('hidden');
            }
        }
    }

    const btnRefreshLocation = document.getElementById('btn-refresh-location');
    if (btnRefreshLocation) {
        btnRefreshLocation.addEventListener('click', async () => {
            const docSnap = await getDoc(doc(db, "system", "emergency_request"));
            if (docSnap.exists()) {
                const req = docSnap.data();
                if (req.status !== 'searching') {
                    alert("Cannot refresh location while an ambulance is on the way.");
                    return;
                }
            }
            requestLocationAndInitMap();
        });
    }

    function startPollingIdleDrivers() {
        if (idlePollingInterval) clearInterval(idlePollingInterval);
        pollIdleDrivers(); // Initial call
        idlePollingInterval = setInterval(pollIdleDrivers, 3000);
    }

    async function pollIdleDrivers() {
        if (!map) return;
        
        // Don't show idle drivers if we have an accepted request
        const reqSnap = await getDoc(doc(db, "system", "emergency_request"));
        if (reqSnap.exists()) {
            const req = reqSnap.data();
            if (req.status === 'accepted') {
                clearIdleMarkers();
                return;
            }
        }

        const driversSnap = await getDoc(doc(db, "system", "online_drivers"));
        if (!driversSnap.exists()) {
            clearIdleMarkers();
            return;
        }

        const drivers = driversSnap.data();
        const currentDriverIds = Object.keys(drivers);

        // Remove markers for drivers who went offline
        Object.keys(idleAmbulanceMarkers).forEach(id => {
            if (!currentDriverIds.includes(id)) {
                map.removeLayer(idleAmbulanceMarkers[id]);
                delete idleAmbulanceMarkers[id];
            }
        });

        // Add or update markers for online drivers
        const ambulanceIcon = L.divIcon({
            className: 'custom-div-icon',
            html: "<div style='background-color:#10b981; width:15px; height:15px; border-radius:50%; display:flex; align-items:center; justify-content:center; color:white; font-size:8px; box-shadow:0 0 5px rgba(16,185,129,0.8);'><i class='fa-solid fa-truck-medical'></i></div>",
            iconSize: [15, 15],
            iconAnchor: [7.5, 7.5]
        });

        currentDriverIds.forEach(id => {
            const driver = drivers[id];
            const name = driver.profile ? driver.profile.name : 'Ambulance';
            if (idleAmbulanceMarkers[id]) {
                idleAmbulanceMarkers[id].setLatLng(driver.location);
            } else {
                idleAmbulanceMarkers[id] = L.marker(driver.location, {icon: ambulanceIcon}).addTo(map)
                    .bindPopup(`Idle: ${name}`);
            }
        });
    }

    function clearIdleMarkers() {
        Object.values(idleAmbulanceMarkers).forEach(marker => {
            map.removeLayer(marker);
        });
        idleAmbulanceMarkers = {};
    }

    // --- Request Logic ---
    const btnRequest = document.getElementById('btn-request');
    const btnCancel = document.getElementById('btn-cancel');
    const bookingSection = document.getElementById('booking-section');
    const activeRequestSection = document.getElementById('active-request-section');
    const userStatus = document.getElementById('user-status');
    const requestStatusText = document.getElementById('request-status-text');
    const driverInfo = document.getElementById('driver-info');
    
    let requestInterval;

    btnRequest.addEventListener('click', async () => {
        if (!userLocation) return alert("Waiting for location...");

        const type = document.getElementById('emergency-type').value;
        const requestId = 'REQ_' + new Date().getTime();
        
        const requestData = {
            id: requestId,
            type: type,
            location: userLocation,
            status: 'searching',
            timestamp: new Date().getTime(),
            userEmail: auth.currentUser?.email || 'Anonymous'
        };

        await setDoc(doc(db, "system", "emergency_request"), requestData);

        bookingSection.classList.add('hidden');
        activeRequestSection.classList.remove('hidden');
        userStatus.className = 'status-badge status-searching';
        userStatus.textContent = 'Searching';
        
        startPollingRequest(requestId);
    });

    btnCancel.addEventListener('click', async () => {
        await deleteDoc(doc(db, "system", "emergency_request"));
        resetUI();
    });

    function resetUI() {
        if (requestInterval) clearInterval(requestInterval);
        bookingSection.classList.remove('hidden');
        activeRequestSection.classList.add('hidden');
        userStatus.className = 'status-badge status-idle';
        userStatus.textContent = 'Idle';
        requestStatusText.textContent = 'Searching for Driver...';
        driverInfo.classList.add('hidden');
        
        if (driverMarker) { map.removeLayer(driverMarker); driverMarker = null; }
        if (routeLine) { map.removeLayer(routeLine); routeLine = null; }
        if (map && userLocation) map.setView(userLocation, 15);
    }

    function startPollingRequest(id) {
        requestInterval = setInterval(async () => {
            const docSnap = await getDoc(doc(db, "system", "emergency_request"));
            if (!docSnap.exists()) { resetUI(); return; }

            const req = docSnap.data();
            if (req.id === id && req.status === 'accepted') {
                requestStatusText.textContent = 'Driver is on the way!';
                driverInfo.classList.remove('hidden');
                document.getElementById('driver-name').textContent = req.driverName || 'Ambulance Unit';
                
                userStatus.className = 'status-badge status-accepted';
                userStatus.textContent = 'Accepted';

                updateDriverLocation(req.driverLocation);
            }
        }, 2000);
    }

    function updateDriverLocation(driverLoc) {
        if (!driverLoc || !map) return;

        if (!driverMarker) {
            const ambulanceIcon = L.divIcon({
                className: 'custom-div-icon',
                html: "<div style='background-color:#ef4444; width:20px; height:20px; border-radius:50%; display:flex; align-items:center; justify-content:center; color:white; font-size:10px;'><i class='fa-solid fa-plus'></i></div>",
                iconSize: [20, 20],
                iconAnchor: [10, 10]
            });
            driverMarker = L.marker(driverLoc, {icon: ambulanceIcon}).addTo(map).bindPopup("Ambulance").openPopup();
        } else {
            driverMarker.setLatLng(driverLoc);
        }

        if (routeLine) map.removeLayer(routeLine);
        routeLine = L.polyline([userLocation, driverLoc], {color: '#ef4444', weight: 4, dashArray: '5, 10'}).addTo(map);
        
        const bounds = L.latLngBounds([userLocation, driverLoc]);
        map.fitBounds(bounds, {padding: [50, 50]});
    }
});
