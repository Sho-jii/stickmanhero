// Stick Hero - Promise Demo Game

// Elements
const gameEl = document.getElementById('game');
const worldEl = document.getElementById('world');
const platformsEl = document.getElementById('platforms');
const stickEl = document.getElementById('stick');
const heroEl = document.getElementById('hero');
const messageEl = document.getElementById('message');
const scoreValueEl = document.getElementById('scoreValue');
const restartBtn = document.getElementById('restartBtn');
const logEl = document.getElementById('log');

// Audio Context for sound effects
let audioContext;
let sounds = {};

// Initialize audio
function initAudio() {
    try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        
        // Create sound effects using Web Audio API
        sounds.grow = () => playTone(200, 0.1, 'sine');
        sounds.drop = () => playTone(150, 0.3, 'sawtooth');
        sounds.success = () => {
            playTone(400, 0.2, 'sine');
            setTimeout(() => playTone(600, 0.2, 'sine'), 100);
        };
        sounds.failure = () => playTone(100, 0.5, 'square');
        sounds.walk = () => playTone(300, 0.05, 'triangle');
    } catch (e) {
        console.log('Audio not supported');
    }
}

function playTone(frequency, duration, type = 'sine') {
    if (!audioContext) return;
    
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    oscillator.frequency.value = frequency;
    oscillator.type = type;
    
    gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration);
    
    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + duration);
}

// Config
const gameWidth = 400;
const minGap = 60;
const maxGap = 160;
const minPlatformWidth = 50;
const maxPlatformWidth = 90;
const stickGrowSpeedPxPerMs = 0.2; // grows while holding
const heroWalkSpeedPxPerMs = 0.15; // pixels per ms
const stickRotateDurationMs = 400;
const cameraPanDurationMs = 600;
const MAX_STICK_LENGTH = 300; // Maximum stick length in pixels

// State
let platforms = []; // {x, width}
let currentIndex = 0; // index of platform where hero stands
let isHolding = false;
let lastHoldTimestamp = 0;
let isAnimating = false;
let score = 0;
let gameOver = false; // Add game over state
let cameraOffsetX = 0; // how much the world is shifted left

// Utility: random integer in [a, b]
function randInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Initialize the scene with the first two platforms
function setupLevel(initial = false) {
    platformsEl.innerHTML = '';
    platforms = [];
    cameraOffsetX = 0;
    worldEl.style.transform = 'translateX(0px)';
    // Ensure hero is back on platform level
    heroEl.style.bottom = 'calc(30% + 120px)';
    heroEl.classList.remove('success', 'failure');
    gameOver = false; // Reset game over state

    // First platform fixed
    const firstWidth = randInt(70, 90);
    const firstX = 30;
    addPlatform(firstX, firstWidth);

    // Second platform random distance and width
    const gap = randInt(minGap, maxGap);
    const secondWidth = randInt(minPlatformWidth, maxPlatformWidth);
    const secondX = firstX + firstWidth + gap;
    addPlatform(secondX, secondWidth);

    // Reset hero, stick, score if initial or restart
    currentIndex = 0;
    placeHeroOnPlatform(platforms[0]);
    resetStick(firstX + firstWidth);
    if (initial) {
        score = 0;
        updateScore(0);
    }
    showMessage('Hold to grow the stick, release to drop');
    restartBtn.hidden = true;
}

function addPlatform(x, width) {
    const p = document.createElement('div');
    p.className = 'platform';
    p.style.left = x + 'px';
    p.style.width = width + 'px';
    platformsEl.appendChild(p);
    platforms.push({ x, width, el: p });
}

function placeHeroOnPlatform(platform) {
    const heroX = platform.x + Math.min(20, platform.width - 22);
    heroEl.style.left = heroX + 'px';
}

function resetStick(pivotX) {
    stickEl.style.left = pivotX + 'px';
    stickEl.style.height = '0px';
    stickEl.style.transform = 'rotate(0deg)';
}

function updateScore(delta) {
    score += delta;
    scoreValueEl.textContent = String(score);
}

function showMessage(text) {
    messageEl.textContent = text;
}

function pushLog(text) {
    const time = new Date().toLocaleTimeString();
    const line = `[${time}] ${text}`;
    const div = document.createElement('div');
    div.textContent = line;
    logEl.appendChild(div);
    logEl.scrollTop = logEl.scrollHeight;
}

// Promise-based round flow
let roundActive = false;
let releaseResolver = null;

// Input: mouse and touch start triggers a round if not already active
function onHoldStart(e) {
    if (roundActive || isAnimating || gameOver) return; // Prevent input when game over
    beginRound();
}

function onHoldEnd(e) {
    if (!isHolding) return;
    isHolding = false;
    if (releaseResolver) {
        releaseResolver();
        releaseResolver = null;
    }
}

function beginRound() {
    roundActive = true;
    isAnimating = false;
    showMessage('Growing... release to drop');
    pushLog('Round started: waiting for release (Promise pending)');

    waitForRelease()
        .then(() => { pushLog('Released -> resolve'); return dropStick(); })
        .then(() => { pushLog('Stick dropped -> resolve'); return evaluateBridge(); })
        .then(({ endX }) => { pushLog('Bridge success -> resolve'); return walkHeroAcross(true, endX); })
        .then(() => { pushLog('Walk finished -> resolve'); return panCameraToCurrent(); })
        .then(() => onSuccessReach())
        .catch(({ endX }) => {
            pushLog('Bridge failed -> reject');
            // Walk to the edge and fall for clarity
            return walkHeroAcross(false, endX).then(() => onFailFall());
        })
        .finally(() => {
            roundActive = false;
        });
}

// Resolves when the user releases OR when max length is reached; grows the stick while pending
function waitForRelease() {
    return new Promise((resolve) => {
        isHolding = true;
        lastHoldTimestamp = performance.now();
        releaseResolver = resolve;
        requestAnimationFrame(growStickStep);
    });
}

function growStickStep(now) {
    if (!isHolding) return;
    const elapsed = now - lastHoldTimestamp;
    lastHoldTimestamp = now;
    const currentHeight = parseFloat(stickEl.style.height);
    const newHeight = currentHeight + elapsed * stickGrowSpeedPxPerMs;
    
    // Check if we've reached max length
    if (newHeight >= MAX_STICK_LENGTH) {
        stickEl.style.height = MAX_STICK_LENGTH + 'px';
        pushLog('Max stick length reached -> auto-release');
        // Auto-release when max length reached
        isHolding = false;
        if (releaseResolver) {
            releaseResolver();
            releaseResolver = null;
        }
        return;
    }
    
    stickEl.style.height = newHeight + 'px';
    
    // Play grow sound occasionally
    if (Math.random() < 0.1) {
        sounds.grow();
    }
    
    requestAnimationFrame(growStickStep);
}

function dropStick() {
    return new Promise((resolve) => {
        isAnimating = true;
        showMessage('Dropping...');
        sounds.drop();
        const start = performance.now();
        const duration = stickRotateDurationMs;
        function step(now) {
            const t = Math.min(1, (now - start) / duration);
            const angle = 90 * easeOutCubic(t);
            stickEl.style.transform = `rotate(${angle}deg)`;
            if (t < 1) {
                requestAnimationFrame(step);
            } else {
                resolve();
            }
        }
        requestAnimationFrame(step);
    });
}

function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
}

function evaluateBridge() {
    return new Promise((resolve, reject) => {
        const from = platforms[currentIndex];
        const to = platforms[currentIndex + 1];
        const pivotX = from.x + from.width;
        const stickLength = parseFloat(stickEl.style.height);
        const endX = pivotX + stickLength;
        const success = endX >= to.x && endX <= to.x + to.width;
        if (success) resolve({ endX }); else reject({ endX });
    });
}

function walkHeroAcross(success, bridgeEndX) {
    return new Promise((resolve) => {
        const from = platforms[currentIndex];
        const to = platforms[currentIndex + 1];
        const startX = parseFloat(heroEl.style.left);
        let targetX;
        
        // Add walking animation
        heroEl.classList.add('walking');
        
        if (success) {
            // Success: walk to the next platform
            targetX = to.x + Math.min(25, to.width - 25);
        } else {
            // Failure: walk to the edge of the stick and fall
            const stickLength = parseFloat(stickEl.style.height);
            const pivotX = from.x + from.width;
            targetX = pivotX + stickLength - 10; // Walk to near the end of stick
        }

        const distance = targetX - startX;
        const duration = Math.abs(distance) / heroWalkSpeedPxPerMs;
        const startTime = performance.now();
        let lastStepTime = startTime;
        
        function step(now) {
            const t = Math.min(1, (now - startTime) / duration);
            heroEl.style.left = startX + distance * t + 'px';
            
            // Play walking sound
            if (now - lastStepTime > 200) {
                sounds.walk();
                lastStepTime = now;
            }
            
            if (t < 1) {
                requestAnimationFrame(step);
            } else {
                heroEl.classList.remove('walking');
                resolve();
            }
        }
        requestAnimationFrame(step);
    });
}

// Camera pan: after a successful cross, slide the world so the new
// platform becomes the left reference again. Returns a Promise.
function panCameraToCurrent() {
    return new Promise((resolve) => {
        const nextPlatform = platforms[currentIndex + 1];
        const desiredLeftMargin = 30;
        const targetOffset = -(nextPlatform.x - desiredLeftMargin);
        const startOffset = cameraOffsetX;
        const distance = targetOffset - startOffset;
        const duration = cameraPanDurationMs;
        const startTime = performance.now();
        function step(now) {
            const t = Math.min(1, (now - startTime) / duration);
            const eased = easeOutCubic(t);
            const value = startOffset + distance * eased;
            cameraOffsetX = value;
            worldEl.style.transform = `translateX(${value}px)`;
            if (t < 1) {
                requestAnimationFrame(step);
            } else {
                resolve();
            }
        }
        requestAnimationFrame(step);
    });
}

function onSuccessReach() {
    updateScore(1);
    currentIndex += 1;
    heroEl.classList.add('success', 'jumping');
    sounds.success();
    
    const last = platforms[platforms.length - 1];
    const gap = randInt(minGap, maxGap);
    const width = randInt(minPlatformWidth, maxPlatformWidth);
    addPlatform(last.x + last.width + gap, width);
    const cur = platforms[currentIndex];
    resetStick(cur.x + cur.width);
    isAnimating = false;
    showMessage('Perfect! Hold to grow again');
    
    // Remove success class after animation
    setTimeout(() => {
        heroEl.classList.remove('success', 'jumping');
    }, 400);
}

function onFailFall() {
    showMessage('Oops! You fell.');
    heroEl.classList.add('failure');
    stickEl.classList.add('failure');
    sounds.failure();
    
    const fallDuration = 800;
    const startTime = performance.now();
    function step(now) {
        const t = Math.min(1, (now - startTime) / fallDuration);
        heroEl.style.bottom = (parseFloat(heroEl.style.bottom) - 250 * t) + 'px';
        if (t < 1) {
            requestAnimationFrame(step);
        } else {
            endGame();
        }
    }
    requestAnimationFrame(step);
}

function endGame() {
    isAnimating = false;
    gameOver = true; // Set game over state
    restartBtn.hidden = false;
    showMessage('Game Over');
    pushLog('Game over');
}

function restart() {
    setupLevel(true);
}

// Wire input
gameEl.addEventListener('mousedown', onHoldStart);
gameEl.addEventListener('touchstart', onHoldStart, { passive: true });
window.addEventListener('mouseup', onHoldEnd);
window.addEventListener('touchend', onHoldEnd);
restartBtn.addEventListener('click', restart);

// Initialize everything
initAudio();
setupLevel(true);

// --- Ambient scenery using Promises ---
const skyEl = document.getElementById('sky');

function spawnCloud() {
    const el = document.createElement('div');
    el.className = 'cloud';
    const y = 20 + Math.random() * 140;
    el.style.top = y + 'px';
    el.style.left = '-60px';
    skyEl.appendChild(el);
    return animateAcross(el, 60_000 + Math.random() * 20_000).finally(() => el.remove());
}

// Returns a Promise that resolves when the element finished moving left->right
function animateAcross(el, durationMs) {
    return new Promise((resolve) => {
        const start = performance.now();
        function step(now) {
            const t = Math.min(1, (now - start) / durationMs);
            const x = -40 + t * (gameEl.clientWidth + 80);
            el.style.transform = `translateX(${x}px)`;
            if (t < 1) requestAnimationFrame(step); else resolve();
        }
        requestAnimationFrame(step);
    });
}

// Loops: start a new one after the previous resolves (clean Promise demo)
function startSceneryLoops() {
    (function loopClouds() { spawnCloud().then(loopClouds); })();
}

startSceneryLoops();


