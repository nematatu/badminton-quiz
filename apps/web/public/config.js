const isLocal = ['localhost', '127.0.0.1'].includes(window.location.hostname);
window.QRAFT_CONFIG = Object.freeze({ API_ORIGIN: isLocal ? '/api' : 'https://api.quiz.example.com' });
