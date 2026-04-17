const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

function playTone(frequency, type, duration, vol, delay = 0) {
    setTimeout(() => {
        if (audioCtx.state === 'suspended') audioCtx.resume();
        const oscillator = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();
        
        oscillator.type = type;
        oscillator.frequency.setValueAtTime(frequency, audioCtx.currentTime);
        
        gainNode.gain.setValueAtTime(vol, audioCtx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
        
        oscillator.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        
        oscillator.start();
        oscillator.stop(audioCtx.currentTime + duration);
    }, delay * 1000);
}

export function playAlertBeep() {
    playTone(600, 'square', 0.2, 0.1, 0);
    playTone(450, 'square', 0.4, 0.1, 0.15);
}

export function playSuccessChirp() {
    playTone(600, 'sine', 0.1, 0.1, 0);
    playTone(900, 'sine', 0.1, 0.1, 0.1);
    playTone(1200, 'sine', 0.2, 0.1, 0.2);
}
