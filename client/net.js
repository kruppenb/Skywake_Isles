// Only the join request survives a disconnected socket. Every game action is live.
const readSession = (key) => { try { return sessionStorage.getItem(key); } catch { return null; } };
const writeSession = (key, value) => { try { value ? sessionStorage.setItem(key, value) : sessionStorage.removeItem(key); } catch { /* Private browsing can disable storage. */ } };

export class GameNet {
  constructor(callbacks = {}) {
    this.callbacks = callbacks;
    this.id = null;
    this.token = readSession('skywake-reconnect');
    this.state = null;
    this.socket = null;
    this.connected = false;
    this.status = 'idle';
    this.credentials = null;
    this.attempt = 0;
    this.retryTimer = 0;
    this.joinTimer = 0;
    this.intentionalClose = false;
    this.generation = 0;
    this.lastMessageAt = 0;
    this.watchdog = setInterval(() => {
      if (this.connected && performance.now() - this.lastMessageAt > 12000) this.socket?.close(4000, 'Connection timed out');
    }, 3000);
    this.onlineHandler = () => {
      if (this.credentials && !this.connected && !this.intentionalClose) {
        clearTimeout(this.retryTimer);
        this.connect();
      }
    };
    window.addEventListener('online', this.onlineHandler);
  }

  setStatus(status, message) {
    this.status = status;
    this.callbacks.onStatus?.({ status, message, attempt: this.attempt });
  }

  join(name, color) {
    this.credentials = { name, color };
    this.intentionalClose = false;
    this.attempt = 0;
    this.connect();
  }

  connect() {
    if (!this.credentials || this.intentionalClose) return;
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) return;
    clearTimeout(this.retryTimer);
    clearTimeout(this.joinTimer);
    const generation = ++this.generation;
    this.connected = false;
    this.setStatus(this.attempt ? 'reconnecting' : 'connecting', this.attempt ? 'Reconnecting to your crew…' : 'Finding your ship…');
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    let socket;
    try {
      socket = new WebSocket(`${protocol}//${location.host}`);
    } catch (error) {
      this.callbacks.onError?.({ message: 'The ship could not connect. Check this address and your network.', code: 'connection' });
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;
    socket.addEventListener('open', () => {
      if (generation !== this.generation) return;
      this.lastMessageAt = performance.now();
      this.send({ type: 'join', ...this.credentials, ...(this.token ? { token: this.token } : {}) }, false);
      this.joinTimer = setTimeout(() => {
        if (!this.connected && socket.readyState === WebSocket.OPEN) socket.close(4000, 'Join timed out');
      }, 10000);
    });
    socket.addEventListener('message', ({ data }) => {
      if (generation !== this.generation || typeof data !== 'string') return;
      this.lastMessageAt = performance.now();
      let message;
      try { message = JSON.parse(data); } catch { return; }
      if (!message || typeof message !== 'object') return;
      if (message.type === 'welcome') {
        clearTimeout(this.joinTimer);
        const reconnected = !!this.id;
        this.id = message.id;
        this.token = message.token;
        this.state = message.state;
        writeSession('skywake-reconnect', this.token);
        this.connected = true;
        this.attempt = 0;
        this.setStatus('connected', 'Crew connected');
        this.callbacks.onWelcome?.({ ...message, reconnected });
        this.callbacks.onState?.(message.state);
      } else if (message.type === 'snapshot' && this.connected) {
        this.state = message.state;
        this.callbacks.onState?.(message.state);
      } else if (message.type === 'event' && this.connected) {
        this.callbacks.onEvent?.(message.event);
      } else if (message.type === 'error') {
        const rejection = !this.connected;
        const code = String(message.code || '').toLowerCase();
        // A restarted server may no longer know a reserved reconnect token.
        if (rejection && this.token && /token|session|reconnect/.test(code)) {
          this.token = null;
          writeSession('skywake-reconnect', null);
          this.send({ type: 'join', ...this.credentials }, false);
          return;
        }
        this.callbacks.onError?.({ message: String(message.message || 'The ship could not complete that action.'), code });
        if (rejection) {
          this.intentionalClose = true;
          clearTimeout(this.retryTimer);
          clearTimeout(this.joinTimer);
          this.setStatus('error', String(message.message || 'Unable to board'));
          socket.close(1000, 'Join rejected');
        }
      }
    });
    socket.addEventListener('close', (event) => {
      if (generation !== this.generation) return;
      clearTimeout(this.joinTimer);
      this.connected = false;
      this.socket = null;
      if (event.code === 4001) {
        this.intentionalClose = true;
        clearTimeout(this.retryTimer);
        this.id = null;
        this.token = null;
        this.credentials = null;
        this.state = null;
        writeSession('skywake-reconnect', null);
        const message = 'This pirate boarded in another tab. Board again to join as a new crewmate.';
        this.setStatus('error', message);
        this.callbacks.onReplaced?.(message);
        return;
      }
      if (!this.intentionalClose) {
        this.setStatus('reconnecting', 'Connection lost. Finding your crew…');
        this.scheduleReconnect();
      }
    });
    socket.addEventListener('error', () => {
      // close supplies a single retry path, including failed TCP connections.
      if (generation === this.generation && !this.connected) this.setStatus('reconnecting', 'Can’t reach the ship. Check that the game server is running.');
    });
  }

  scheduleReconnect() {
    if (this.intentionalClose || !this.credentials) return;
    this.attempt += 1;
    const delay = Math.min(8000, 650 * 2 ** Math.min(this.attempt - 1, 4));
    this.retryTimer = setTimeout(() => this.connect(), delay + Math.random() * 180);
  }

  send(message, requireJoined = true) {
    if ((requireJoined && !this.connected) || this.socket?.readyState !== WebSocket.OPEN) return false;
    try { this.socket.send(JSON.stringify(message)); return true; } catch { return false; }
  }

  sendInput(input) { return this.send({ type: 'input', ...input }); }
  action(action, target) { return this.send({ type: 'action', action, ...(target == null ? {} : { target }) }); }

  leave() {
    this.send({ type: 'leave' });
    this.intentionalClose = true;
    clearTimeout(this.retryTimer);
    clearTimeout(this.joinTimer);
    this.generation += 1;
    this.socket?.close(1000, 'Left the crew');
    this.socket = null;
    this.connected = false;
    this.id = null;
    this.token = null;
    this.credentials = null;
    this.state = null;
    writeSession('skywake-reconnect', null);
    this.setStatus('idle', 'Ready to board');
  }

  dispose() {
    this.leave();
    clearInterval(this.watchdog);
    window.removeEventListener('online', this.onlineHandler);
  }
}
