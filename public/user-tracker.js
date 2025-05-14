/**
 * Advanced User Behavior Tracking Script
 * Version 2.0
 * Tracks: mouse movements, clicks, scroll depth, inactivity, and time spent
 * 
 * This script captures comprehensive user behavior data and sends it to your backend.
 * Features include:
 * - Session persistence across page refreshes
 * - Automatic retry of failed data transmissions
 * - Scroll depth tracking
 * - Inactivity detection
 * - Optimized data batching
 * - Heatmap visualization capabilities
 */

// Configuration options
const config = {
  // Sampling rate for mouse movements (ms) - lower = more data but higher load
  mouseSamplingRate: 100,
  
  // How many mouse positions to store before sending to server 
  mouseBatchSize: 30,
  
  // How often to send data to server (ms)
  sendInterval: 5000,
  
  // The URL where data will be sent
  backendUrl: '/api/tracking/track', // Change this to your actual endpoint
  
  // Inactivity threshold in milliseconds (1 minute)
  inactivityThreshold: 60 * 1000,
  
  // Debug mode - logs events to console
  debug: false,
  
  // Maximum number of retry attempts for failed API requests
  maxRetryAttempts: 3,
  
  // Delay between retry attempts (ms)
  retryDelay: 2000,
  
  // Maximum stored positions before older ones are discarded
  maxStoredPositions: 500,
  
  // Sampling rate for scroll tracking (ms)
  scrollSamplingRate: 500
};

/**
 * UserTracker Class - Main tracking implementation
 */
class UserTracker {
  constructor() {
    // Store all tracking data
    this.data = {
      sessionId: this.getOrCreateSessionId(),
      startTime: Date.now(),
      mousePositions: [],
      clicks: [],
      scrollPositions: [],
      scrollDepth: 0,
      timeSpent: 0,
      pageUrl: window.location.href,
      referrer: document.referrer,
      screenWidth: window.innerWidth,
      screenHeight: window.innerHeight,
      userAgent: navigator.userAgent,
      inactive: false
    };
    
    // Flags and timers
    this.isTracking = false;
    this.mouseTimer = null;
    this.timeSpentTimer = null;
    this.scrollTimer = null;
    this.sendDataTimer = null;
    this.lastActivityTime = Date.now();
    this.isVisible = true;
    this.retryQueue = [];
    this.retryAttempts = 0;
    this.maxScrollDepth = 0;
    
    // Bind methods
    this.trackMousePosition = this.trackMousePosition.bind(this);
    this.trackClick = this.trackClick.bind(this);
    this.trackScroll = this.trackScroll.bind(this);
    this.trackTimeSpent = this.trackTimeSpent.bind(this);
    this.handleVisibilityChange = this.handleVisibilityChange.bind(this);
    this.handleWindowResize = this.handleWindowResize.bind(this);
    this.sendData = this.sendData.bind(this);
    this.processSendQueue = this.processSendQueue.bind(this);
    this.onBeforeUnload = this.onBeforeUnload.bind(this);
    this.checkInactivity = this.checkInactivity.bind(this);
    
    // Initialize storage
    this.initStorage();
  }
  
  // Get existing session ID or create a new one
  getOrCreateSessionId() {
    let sessionId = sessionStorage.getItem('userTrackingSessionId');
    
    if (!sessionId) {
      sessionId = 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
      sessionStorage.setItem('userTrackingSessionId', sessionId);
    }
    
    return sessionId;
  }
  
  // Initialize local storage for persistence
  initStorage() {
    // Try to restore session from localStorage
    const savedSession = localStorage.getItem('userTrackingSession');
    if (savedSession) {
      try {
        const parsedSession = JSON.parse(savedSession);
        // Only restore if session is less than 30 minutes old
        if (Date.now() - parsedSession.startTime < 30 * 60 * 1000) {
          this.data = {
            ...parsedSession,
            // Reset arrays to prevent them from getting too large
            mousePositions: [],
            clicks: [],
            scrollPositions: []
          };
          this.data.timeSpent = this.calculateElapsedTime(this.data.startTime);
          if (config.debug) console.log('Restored session:', this.data);
        }
      } catch (e) {
        console.error('Error restoring session:', e);
      }
    }
    
    // Check for any failed requests that need to be retried
    const failedData = localStorage.getItem('failedTrackingData');
    if (failedData) {
      try {
        this.retryQueue = JSON.parse(failedData);
        if (config.debug) console.log('Restored retry queue:', this.retryQueue);
      } catch (e) {
        console.error('Error restoring retry queue:', e);
        localStorage.removeItem('failedTrackingData');
      }
    }
  }
  
  // Start tracking user behavior
  start() {
    if (this.isTracking) return;
    this.isTracking = true;
    
    // Track mouse movement
    document.addEventListener('mousemove', this.trackMousePosition);
    
    // Track clicks
    document.addEventListener('click', this.trackClick);
    
    // Track scroll
    window.addEventListener('scroll', this.trackScroll);
    
    // Track window resize
    window.addEventListener('resize', this.handleWindowResize);
    
    // Track page visibility
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
    
    // Track before unload
    window.addEventListener('beforeunload', this.onBeforeUnload);
    
    // Additional events for activity tracking
    document.addEventListener('keydown', this.updateLastActivity.bind(this));
    document.addEventListener('touchstart', this.updateLastActivity.bind(this));
    
    // Start time tracking
    this.timeSpentTimer = setInterval(this.trackTimeSpent, 1000);
    
    // Schedule data sending
    this.sendDataTimer = setInterval(this.sendData, config.sendInterval);
    
    // Process retry queue
    this.processSendQueue();
    
    // Check for inactivity
    setInterval(this.checkInactivity, config.inactivityThreshold / 2);
    
    if (config.debug) console.log('User tracking started');
  }
  
  // Stop tracking
  stop() {
    if (!this.isTracking) return;
    
    // Remove event listeners
    document.removeEventListener('mousemove', this.trackMousePosition);
    document.removeEventListener('click', this.trackClick);
    window.removeEventListener('scroll', this.trackScroll);
    window.removeEventListener('resize', this.handleWindowResize);
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    window.removeEventListener('beforeunload', this.onBeforeUnload);
    document.removeEventListener('keydown', this.updateLastActivity.bind(this));
    document.removeEventListener('touchstart', this.updateLastActivity.bind(this));
    
    // Clear timers
    clearInterval(this.mouseTimer);
    clearInterval(this.timeSpentTimer);
    clearInterval(this.scrollTimer);
    clearInterval(this.sendDataTimer);
    
    this.isTracking = false;
    
    // Send final data
    this.sendData(true);
    
    if (config.debug) console.log('User tracking stopped');
  }
  
  // Track mouse position
  trackMousePosition(event) {
    // Throttle mouse movement recording
    if (!this.mouseTimer) {
      this.mouseTimer = setTimeout(() => {
        const position = {
          x: event.clientX,
          y: event.clientY,
          timestamp: Date.now()
        };
        
        this.data.mousePositions.push(position);
        
        // Keep array at reasonable size
        if (this.data.mousePositions.length > config.maxStoredPositions) {
          this.data.mousePositions = this.data.mousePositions.slice(-config.mouseBatchSize);
        }
        
        this.mouseTimer = null;
        this.updateLastActivity();
      }, config.mouseSamplingRate);
    }
  }
  
  // Track clicks
  trackClick(event) {
    const target = event.target;
    
    // Create a simpler representation of the target element
    const targetElement = {
      tagName: target.tagName,
      id: target.id || '',
      className: Array.from(target.classList || []).join(' '),
      text: this.getElementText(target),
      href: target.href || '',
      xpath: this.getXPath(target)
    };
    
    const clickInfo = {
      timestamp: Date.now(),
      x: event.clientX,
      y: event.clientY,
      target: targetElement
    };
    
    this.data.clicks.push(clickInfo);
    this.updateLastActivity();
    
    if (config.debug) console.log('Click tracked:', clickInfo);
  }
  
  // Track scroll position and depth
  trackScroll() {
    // Throttle scroll recording
    if (!this.scrollTimer) {
      this.scrollTimer = setTimeout(() => {
        // Calculate scroll depth as percentage
        const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
        const totalHeight = Math.max(
          document.body.scrollHeight,
          document.documentElement.scrollHeight,
          document.body.offsetHeight,
          document.documentElement.offsetHeight,
          document.body.clientHeight,
          document.documentElement.clientHeight
        ) - window.innerHeight;
        
        const scrollPercentage = totalHeight > 0 ? Math.round((scrollTop / totalHeight) * 100) : 0;
        
        // Record scroll position
        const scrollInfo = {
          position: scrollPercentage,
          timestamp: Date.now()
        };
        
        this.data.scrollPositions.push(scrollInfo);
        
        // Keep array at reasonable size
        if (this.data.scrollPositions.length > 50) {
          this.data.scrollPositions = this.data.scrollPositions.slice(-20);
        }
        
        // Update max scroll depth
        if (scrollPercentage > this.maxScrollDepth) {
          this.maxScrollDepth = scrollPercentage;
          this.data.scrollDepth = this.maxScrollDepth;
        }
        
        this.scrollTimer = null;
        this.updateLastActivity();
      }, config.scrollSamplingRate);
    }
  }
  
  // Get XPath for an element (useful for more precise element identification)
  getXPath(element) {
    try {
      if (!element) return '';
      
      let xpath = '';
      let parent = null;
      
      // If element has ID, use that (simplest case)
      if (element.id) {
        return `//*[@id="${element.id}"]`;
      }
      
      // Navigate up the DOM
      for (; element && element.nodeType === 1; element = element.parentNode) {
        // Get the element's position among siblings
        let count = 1;
        for (let sibling = element.previousSibling; sibling; sibling = sibling.previousSibling) {
          if (sibling.nodeType === 1 && sibling.tagName === element.tagName) {
            count++;
          }
        }
        
        // Create XPath component
        const xpathComponent = element.tagName.toLowerCase() + 
          (count > 1 ? `[${count}]` : '');
        
        xpath = '/' + xpathComponent + xpath;
      }
      
      return xpath || '';
    } catch (e) {
      return '';
    }
  }
  
  // Get text content of element (safely)
  getElementText(element) {
    try {
      // Get only the direct text of this element, not children
      let text = '';
      for (let i = 0; i < element.childNodes.length; i++) {
        if (element.childNodes[i].nodeType === Node.TEXT_NODE) {
          text += element.childNodes[i].textContent;
        }
      }
      
      // If no direct text, try innerText (but limit it)
      if (!text.trim() && element.innerText) {
        text = element.innerText;
      }
      
      // Trim and limit length
      return text.trim().substring(0, 100);
    } catch (e) {
      return '';
    }
  }
  
  // Handle window resize
  handleWindowResize() {
    this.data.screenWidth = window.innerWidth;
    this.data.screenHeight = window.innerHeight;
    this.updateLastActivity();
  }
  
  // Calculate elapsed time
  calculateElapsedTime(startTime) {
    return Math.floor((Date.now() - startTime) / 1000);
  }
  
  // Track time spent
  trackTimeSpent() {
    if (!this.isVisible) return;
    
    this.data.timeSpent = this.calculateElapsedTime(this.data.startTime);
    
    // Save session data periodically
    if (this.data.timeSpent % 10 === 0) {
      localStorage.setItem('userTrackingSession', JSON.stringify(this.data));
    }
  }
  
  // Update last activity timestamp
  updateLastActivity() {
    this.lastActivityTime = Date.now();
    
    // If user was previously inactive, mark as active again
    if (this.data.inactive) {
      this.data.inactive = false;
      if (config.debug) console.log('User is active again');
    }
  }
  
  // Check for user inactivity
  checkInactivity() {
    const now = Date.now();
    if (now - this.lastActivityTime > config.inactivityThreshold) {
      if (!this.data.inactive) {
        this.data.inactive = true;
        if (config.debug) console.log('User inactive for more than', config.inactivityThreshold/1000, 'seconds');
        // Send current data with inactivity flag
        this.sendData();
      }
    }
  }
  
  // Handle visibility change (tab switching)
  handleVisibilityChange() {
    this.isVisible = document.visibilityState === 'visible';
    
    if (this.isVisible) {
      this.updateLastActivity();
    } else {
      // Send data when user leaves tab
      this.sendData();
    }
  }
  
  // Process send queue (retry failed requests)
  processSendQueue() {
    if (this.retryQueue.length > 0 && navigator.onLine) {
      const dataToSend = this.retryQueue.shift();
      
      fetch(config.backendUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(dataToSend)
      })
      .then(response => {
        if (!response.ok) {
          throw new Error('Server returned error: ' + response.status);
        }
        if (config.debug) console.log('Successfully resent queued data');
        
        // Update localStorage with the remaining queue
        if (this.retryQueue.length > 0) {
          localStorage.setItem('failedTrackingData', JSON.stringify(this.retryQueue));
        } else {
          localStorage.removeItem('failedTrackingData');
        }
        
        // Reset retry counter on success
        this.retryAttempts = 0;
      })
      .catch(error => {
        if (config.debug) console.error('Error resending queued data:', error);
        
        // Put the failed data back in the queue if under max attempts
        if (this.retryAttempts < config.maxRetryAttempts) {
          this.retryQueue.unshift(dataToSend);
          this.retryAttempts++;
          
          // Schedule another retry with exponential backoff
          setTimeout(this.processSendQueue, 
            config.retryDelay * Math.pow(2, this.retryAttempts - 1));
        } else {
          // Max retries reached, update storage
          if (this.retryQueue.length > 0) {
            localStorage.setItem('failedTrackingData', JSON.stringify(this.retryQueue));
          } else {
            localStorage.removeItem('failedTrackingData');
          }
          
          // Reset retry counter
          this.retryAttempts = 0;
        }
      });
    }
  }
  
  // Send data to server
  sendData(isFinal = false) {
    // Don't send if there's no new data and not a final request
    if (this.data.mousePositions.length === 0 && 
        this.data.clicks.length === 0 && 
        this.data.scrollPositions.length === 0 && 
        !isFinal) {
      return;
    }
    
    // Update time spent
    this.data.timeSpent = this.calculateElapsedTime(this.data.startTime);
    
    // Create a copy of the data to send
    const dataToSend = {
      sessionId: this.data.sessionId,
      pageUrl: this.data.pageUrl,
      referrer: this.data.referrer,
      startTime: this.data.startTime,
      timeSpent: this.data.timeSpent,
      screenWidth: this.data.screenWidth,
      screenHeight: this.data.screenHeight,
      userAgent: this.data.userAgent,
      mousePositions: [...this.data.mousePositions],
      clicks: [...this.data.clicks],
      scrollPositions: [...this.data.scrollPositions],
      scrollDepth: this.data.scrollDepth,
      inactive: this.data.inactive,
      isFinal: isFinal
    };
    
    // Clear the arrays after copying
    this.data.mousePositions = [];
    this.data.clicks = [];
    this.data.scrollPositions = [];
    
    // Send data to the server
    if (config.debug) {
      console.log('Sending tracking data:', dataToSend);
    }
    
    try {
      // Use the Beacon API for final data sending (works better on page unload)
      if (isFinal && navigator.sendBeacon) {
        const result = navigator.sendBeacon(
          config.backendUrl, 
          JSON.stringify(dataToSend)
        );
        
        if (!result && config.debug) {
          console.warn('Beacon API failed, falling back to fetch');
        }
      }
      
      // Use fetch API for regular data sending
      if (!isFinal || (isFinal && navigator.sendBeacon && !navigator.sendBeacon(config.backendUrl, JSON.stringify(dataToSend)))) {
        fetch(config.backendUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(dataToSend),
          // Keep the connection alive even when page is unloading
          keepalive: true
        })
        .then(response => {
          if (!response.ok) {
            throw new Error('Server returned error: ' + response.status);
          }
          if (config.debug) console.log('Successfully sent tracking data');
        })
        .catch(error => {
          if (config.debug) console.error('Error sending tracking data:', error);
          
          // Add to retry queue
          this.retryQueue.push(dataToSend);
          localStorage.setItem('failedTrackingData', JSON.stringify(this.retryQueue));
          
          // Try to process the queue on the next interval
          setTimeout(this.processSendQueue, config.retryDelay);
        });
      }
    } catch (error) {
      if (config.debug) console.error('Error sending tracking data:', error);
      
      // Add to retry queue on error
      this.retryQueue.push(dataToSend);
      localStorage.setItem('failedTrackingData', JSON.stringify(this.retryQueue));
    }
  }
  
  // Handle before unload event
  onBeforeUnload() {
    // Final data sending
    this.sendData(true);
  }
  
  // Get current tracking data
  getData() {
    return {...this.data};
  }
  
  // Set the debug mode
  setDebugMode(enabled) {
    config.debug = enabled;
    return this;
  }
  
  // Set the backend URL
  setBackendUrl(url) {
    config.backendUrl = url;
    return this;
  }
  
  // Set the send interval
  setSendInterval(interval) {
    if (interval >= 1000) {
      config.sendInterval = interval;
      
      // Reset the timer
      if (this.sendDataTimer) {
        clearInterval(this.sendDataTimer);
        this.sendDataTimer = setInterval(this.sendData, config.sendInterval);
      }
    }
    
    return this;
  }
}
/**
 * HeatmapVisualizer Class - Creates visual representations of user behavior
 */
class HeatmapVisualizer {
  constructor(tracker) {
    this.tracker = tracker;
    this.canvas = null;
    this.ctx = null;
    this.colorScheme = {
      low: 'rgba(0, 0, 255, 0.6)',    // Blue
      medium: 'rgba(0, 255, 0, 0.6)', // Green
      high: 'rgba(255, 255, 0, 0.6)', // Yellow
      critical: 'rgba(255, 0, 0, 0.6)' // Red
    };
    this.pointRadius = 20;
    this.maxOpacity = 0.8;
    this.active = false;
    this.heatData = null;
    this.showClicks = true;
    this.showMovement = true;
    
    // Bind methods
    this.createHeatmap = this.createHeatmap.bind(this);
    this.drawPoint = this.drawPoint.bind(this);
    this.drawHeatmap = this.drawHeatmap.bind(this);
    this.remove = this.remove.bind(this);
    this.handleResize = this.handleResize.bind(this);
    
    // Add resize handler
    window.addEventListener('resize', this.handleResize);
  }
  
  // Create a heatmap visualization
  createHeatmap(options = {}) {
    // Remove any existing canvas
    this.remove();
    
    // Set options
    this.showClicks = options.showClicks !== undefined ? options.showClicks : true;
    this.showMovement = options.showMovement !== undefined ? options.showMovement : true;
    this.pointRadius = options.radius || 20;
    
    // Create a canvas overlay
    this.canvas = document.createElement('canvas');
    this.resizeCanvas();
    
    this.canvas.style.position = 'absolute';
    this.canvas.style.top = '0';
    this.canvas.style.left = '0';
    this.canvas.style.pointerEvents = 'none';
    this.canvas.style.zIndex = '9999';
    this.canvas.style.opacity = '0.8';
    
    document.body.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    
    // Mark as active
    this.active = true;
    
    // Draw the heatmap
    this.drawHeatmap();
    
    return this;
  }
  
  // Resize canvas to match window size
  resizeCanvas() {
    if (!this.canvas) return;
    
    this.canvas.width = window.innerWidth;
    this.canvas.height = Math.max(
      document.body.scrollHeight,
      document.documentElement.scrollHeight,
      document.body.offsetHeight,
      document.documentElement.offsetHeight,
      document.body.clientHeight,
      document.documentElement.clientHeight
    );
  }
  
  // Handle window resize
  handleResize() {
    if (this.active) {
      this.resizeCanvas();
      this.drawHeatmap();
    }
  }
  
  // Load data from the server
  async loadData(pageUrl, startDate, endDate) {
    try {
      // Build query string
      let url = `/api/tracking/heatmap?pageUrl=${encodeURIComponent(pageUrl)}`;
      if (startDate) url += `&startDate=${encodeURIComponent(startDate)}`;
      if (endDate) url += `&endDate=${encodeURIComponent(endDate)}`;
      
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Server returned error: ${response.status}`);
      }
      
      const data = await response.json();
      if (data.success) {
        this.heatData = data;
        return data;
      } else {
        throw new Error(data.error || 'Unknown error');
      }
    } catch (error) {
      console.error('Error loading heatmap data:', error);
      return null;
    }
  }
  
  // Draw a point on the heatmap
  drawPoint(x, y, intensity = 1, radius = this.pointRadius) {
    if (!this.ctx) return;
    
    // Determine color based on intensity (0-1)
    let color;
    if (intensity < 0.25) {
      color = this.colorScheme.low;
    } else if (intensity < 0.5) {
      color = this.colorScheme.medium;
    } else if (intensity < 0.75) {
      color = this.colorScheme.high;
    } else {
      color = this.colorScheme.critical;
    }
    
    // Create radial gradient
    const gradient = this.ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, color);
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    
    this.ctx.fillStyle = gradient;
    this.ctx.beginPath();
    this.ctx.arc(x, y, radius, 0, Math.PI * 2);
    this.ctx.fill();
  }
  
  // Draw the entire heatmap
  drawHeatmap() {
    if (!this.ctx) return;
    
    // Clear canvas
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    
    if (this.heatData) {
      // Use server data
      if (this.showClicks) {
        // Draw clicks with higher intensity
        this.heatData.clickData.forEach(click => {
          this.drawPoint(click.x, click.y, 0.9, this.pointRadius * 1.2);
        });
      }
      
      if (this.showMovement) {
        // Draw mouse movements with lower intensity
        this.heatData.movementData.forEach(pos => {
          this.drawPoint(pos.x, pos.y, 0.3, this.pointRadius * 0.8);
        });
      }
    } else {
      // Use local data from tracker
      const data = this.tracker.getData();
      
      if (this.showClicks) {
        // Draw clicks with higher intensity
        data.clicks.forEach(click => {
          this.drawPoint(click.x, click.y, 0.9, this.pointRadius * 1.2);
        });
      }
      
      if (this.showMovement) {
        // Draw mouse movements with lower intensity
        data.mousePositions.forEach(pos => {
          this.drawPoint(pos.x, pos.y, 0.3, this.pointRadius * 0.8);
        });
      }
    }
  }
  
  // Set visualization options
  setOptions(options = {}) {
    if (options.showClicks !== undefined) {
      this.showClicks = options.showClicks;
    }
    
    if (options.showMovement !== undefined) {
      this.showMovement = options.showMovement;
    }
    
    if (options.radius) {
      this.pointRadius = options.radius;
    }
    
    if (options.colorScheme) {
      this.colorScheme = { ...this.colorScheme, ...options.colorScheme };
    }
    
    // Redraw if active
    if (this.active) {
      this.drawHeatmap();
    }
    
    return this;
  }
  
  // Remove the heatmap
  remove() {
    if (this.canvas) {
      document.body.removeChild(this.canvas);
      this.canvas = null;
      this.ctx = null;
      this.active = false;
    }
    
    return this;
  }
}

/**
 * AnalyticsDashboard Class - For displaying analytics
 */
class AnalyticsDashboard {
  constructor(containerId = 'analytics-dashboard') {
    this.containerId = containerId;
    this.container = null;
    this.analyticsData = null;
    this.currentView = 'overview';
    this.dateRange = {
      start: null,
      end: null
    };
    
    // Initialize
    this.init();
  }
  
  // Initialize the dashboard
  init() {
    // Create container if it doesn't exist
    if (!document.getElementById(this.containerId)) {
      this.container = document.createElement('div');
      this.container.id = this.containerId;
      this.container.className = 'analytics-dashboard';
      this.container.style.display = 'none';
      document.body.appendChild(this.container);
    } else {
      this.container = document.getElementById(this.containerId);
    }
    
    // Create initial structure
    this.container.innerHTML = `
      <div class="dashboard-header">
        <h2>User Behavior Analytics</h2>
        <div class="dashboard-controls">
          <div class="date-selector">
            <label>From: <input type="date" id="analytics-date-start"></label>
            <label>To: <input type="date" id="analytics-date-end"></label>
            <button id="analytics-refresh">Refresh</button>
          </div>
          <button id="analytics-close">×</button>
        </div>
      </div>
      <div class="dashboard-content">
        <div class="dashboard-nav">
          <button data-view="overview" class="active">Overview</button>
          <button data-view="heatmap">Heatmap</button>
          <button data-view="sessions">Sessions</button>
          <button data-view="pages">Pages</button>
        </div>
        <div class="dashboard-view" id="analytics-view-container">
          <div class="loading">Loading analytics data...</div>
        </div>
      </div>
    `;
    
    // Set default date range to last 30 days
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 30);
    
    document.getElementById('analytics-date-start').valueAsDate = startDate;
    document.getElementById('analytics-date-end').valueAsDate = endDate;
    
    this.dateRange.start = startDate.toISOString().split('T')[0];
    this.dateRange.end = endDate.toISOString().split('T')[0];
    
    // Add event listeners
    document.getElementById('analytics-close').addEventListener('click', () => {
      this.hide();
    });
    
    document.getElementById('analytics-refresh').addEventListener('click', () => {
      this.dateRange.start = document.getElementById('analytics-date-start').value;
      this.dateRange.end = document.getElementById('analytics-date-end').value;
      this.loadData();
    });
    
    // Nav buttons
    const navButtons = document.querySelectorAll('.dashboard-nav button');
    navButtons.forEach(button => {
      button.addEventListener('click', (e) => {
        navButtons.forEach(btn => btn.classList.remove('active'));
        button.classList.add('active');
        this.currentView = button.dataset.view;
        this.renderView();
      });
    });
    
    // Apply some base styles
    this.applyStyles();
  }
  
  // Apply CSS styles to the dashboard
  applyStyles() {
    const style = document.createElement('style');
    style.textContent = `
      .analytics-dashboard {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(255, 255, 255, 0.98);
        z-index: 10000;
        display: flex;
        flex-direction: column;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      }
      
      .dashboard-header {
        padding: 15px;
        border-bottom: 1px solid #e0e0e0;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      
      .dashboard-header h2 {
        margin: 0;
        font-size: 1.5rem;
        color: #333;
      }
      
      .dashboard-controls {
        display: flex;
        align-items: center;
      }
      
      .date-selector {
        margin-right: 20px;
      }
      
      #analytics-close {
        background: none;
        border: none;
        font-size: 24px;
        cursor: pointer;
        color: #666;
      }
      
      .dashboard-content {
        display: flex;
        flex: 1;
        overflow: hidden;
      }
      
      .dashboard-nav {
        width: 180px;
        border-right: 1px solid #e0e0e0;
        padding: 15px 0;
      }
      
      .dashboard-nav button {
        display: block;
        width: 100%;
        padding: 10px 15px;
        text-align: left;
        background: none;
        border: none;
        cursor: pointer;
        font-size: 14px;
        border-left: 3px solid transparent;
      }
      
      .dashboard-nav button.active {
        background-color: #f0f0f0;
        border-left-color: #0066cc;
        font-weight: bold;
      }
      
      .dashboard-view {
        flex: 1;
        padding: 20px;
        overflow-y: auto;
      }
      
      .stat-card {
        background: white;
        border-radius: 5px;
        box-shadow: 0 2px 5px rgba(0, 0, 0, 0.1);
        padding: 15px;
        margin-bottom: 15px;
      }
      
      .stat-value {
        font-size: 24px;
        font-weight: bold;
        margin: 10px 0;
        color: #0066cc;
      }
      
      .stat-label {
        color: #666;
        font-size: 14px;
      }
      
      .stats-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
        gap: 15px;
        margin-bottom: 30px;
      }
      
      .chart-container {
        background: white;
        border-radius: 5px;
        box-shadow: 0 2px 5px rgba(0, 0, 0, 0.1);
        padding: 15px;
        margin-bottom: 15px;
      }
      
      .section-title {
        margin-top: 30px;
        margin-bottom: 15px;
        font-size: 18px;
        color: #333;
        border-bottom: 1px solid #eee;
        padding-bottom: 5px;
      }
      
      table.data-table {
        width: 100%;
        border-collapse: collapse;
      }
      
      table.data-table th, table.data-table td {
        padding: 10px;
        text-align: left;
        border-bottom: 1px solid #e0e0e0;
      }
      
      table.data-table th {
        background-color: #f5f5f5;
        font-weight: bold;
      }
      
      .loading {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 200px;
        color: #666;
      }
      
      .heatmap-controls {
        margin-bottom: 15px;
      }
      
      .heatmap-container {
        position: relative;
        border: 1px solid #ddd;
        overflow: auto;
        max-height: 600px;
      }
      
      .toggle-group {
        display: flex;
        gap: 10px;
        margin-bottom: 10px;
      }
      
      .toggle-group label {
        display: flex;
        align-items: center;
        gap: 5px;
      }
    `;
    
    document.head.appendChild(style);
  }
  
  // Load analytics data from the server
  async loadData() {
    try {
      const viewContainer = document.getElementById('analytics-view-container');
      viewContainer.innerHTML = '<div class="loading">Loading analytics data...</div>';
      
      let url = `/api/tracking/analytics?startDate=${this.dateRange.start}&endDate=${this.dateRange.end}`;
      
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Server returned error: ${response.status}`);
      }
      
      const data = await response.json();
      if (data.success) {
        this.analyticsData = data;
        this.renderView();
      } else {
        throw new Error(data.error || 'Unknown error');
      }
    } catch (error) {
      console.error('Error loading analytics data:', error);
      document.getElementById('analytics-view-container').innerHTML = 
        `<div class="error-message">Error loading data: ${error.message}</div>`;
    }
  }
  
  // Render the current view
  renderView() {
    if (!this.analyticsData) {
      this.loadData();
      return;
    }
    
    const viewContainer = document.getElementById('analytics-view-container');
    
    switch (this.currentView) {
      case 'overview':
        this.renderOverview(viewContainer);
        break;
      case 'heatmap':
        this.renderHeatmap(viewContainer);
        break;
      case 'sessions':
        this.renderSessions(viewContainer);
        break;
      case 'pages':
        this.renderPages(viewContainer);
        break;
      default:
        this.renderOverview(viewContainer);
    }
  }
  
  // Render overview view
  renderOverview(container) {
    const data = this.analyticsData;
    
    container.innerHTML = `
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-label">Total Sessions</div>
          <div class="stat-value">${data.totalSessions}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Average Time Per Session</div>
          <div class="stat-value">${this.formatTime(data.averageTimePerSession)}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Desktop Users</div>
          <div class="stat-value">${data.deviceBreakdown.desktop}</div>
          <div class="stat-label">${this.calculatePercentage(data.deviceBreakdown.desktop, data.totalSessions)}%</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Mobile Users</div>
          <div class="stat-value">${data.deviceBreakdown.mobile}</div>
          <div class="stat-label">${this.calculatePercentage(data.deviceBreakdown.mobile, data.totalSessions)}%</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Tablet Users</div>
          <div class="stat-value">${data.deviceBreakdown.tablet}</div>
          <div class="stat-label">${this.calculatePercentage(data.deviceBreakdown.tablet, data.totalSessions)}%</div>
        </div>
      </div>
      
      <h3 class="section-title">Top Pages</h3>
      <div class="chart-container">
        <table class="data-table">
          <thead>
            <tr>
              <th>Page URL</th>
              <th>Views</th>
              <th>Percentage</th>
            </tr>
          </thead>
          <tbody>
            ${data.topPages.map(page => `
              <tr>
                <td>${page.url}</td>
                <td>${page.count}</td>
                <td>${this.calculatePercentage(page.count, data.totalSessions)}%</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }
  
  // Render heatmap view
  renderHeatmap(container) {
    container.innerHTML = `
      <div class="heatmap-controls">
        <div class="form-group">
          <label for="heatmap-page-url">Page URL:</label>
          <input type="text" id="heatmap-page-url" value="${window.location.pathname}" style="width: 300px;">
          <button id="load-heatmap">Load Heatmap</button>
        </div>
        <div class="toggle-group">
          <label><input type="checkbox" id="show-clicks" checked> Show Clicks</label>
          <label><input type="checkbox" id="show-movement" checked> Show Mouse Movement</label>
        </div>
      </div>
      
      <div class="heatmap-container" id="heatmap-container" style="height: 600px;">
        <div class="loading">Select a page and click "Load Heatmap" to view data</div>
      </div>
    `;
    
    // Add event listeners
    document.getElementById('load-heatmap').addEventListener('click', () => {
      this.loadHeatmap();
    });
    
    document.getElementById('show-clicks').addEventListener('change', (e) => {
      if (window.activeHeatmap) {
        window.activeHeatmap.setOptions({ showClicks: e.target.checked });
      }
    });
    
    document.getElementById('show-movement').addEventListener('change', (e) => {
      if (window.activeHeatmap) {
        window.activeHeatmap.setOptions({ showMovement: e.target.checked });
      }
    });
  }
  
  // Load heatmap data
  async loadHeatmap() {
    const container = document.getElementById('heatmap-container');
    const pageUrl = document.getElementById('heatmap-page-url').value;
    
    if (!pageUrl) {
      alert('Please enter a page URL');
      return;
    }
    
    container.innerHTML = '<div class="loading">Loading heatmap data...</div>';
    
    // Create iframe to display the page with heatmap overlay
    const iframe = document.createElement('iframe');
    iframe.style.width = '100%';
    iframe.style.height = '100%';
    iframe.style.border = 'none';
    
    // Load the selected page
    iframe.src = pageUrl;
    
    container.innerHTML = '';
    container.appendChild(iframe);
    
    iframe.onload = async () => {
      try {
        // Create heatmap instance in iframe
        const iframeWindow = iframe.contentWindow;
        const visualizer = new HeatmapVisualizer({ getData: () => ({ mousePositions: [], clicks: [] }) });
        
        // Load data from server
        const showClicks = document.getElementById('show-clicks').checked;
        const showMovement = document.getElementById('show-movement').checked;
        
        await visualizer.loadData(
          pageUrl, 
          this.dateRange.start, 
          this.dateRange.end
        );
        
        // Apply heatmap to iframe
        iframeWindow.document.body.appendChild(visualizer.canvas);
        visualizer.createHeatmap({ showClicks, showMovement });
        
        // Save reference for controls
        window.activeHeatmap = visualizer;
        
      } catch (error) {
        console.error('Error loading heatmap:', error);
        container.innerHTML = `<div class="error-message">Error loading heatmap: ${error.message}</div>`;
      }
    };
  }
  
  // Render sessions view
  renderSessions(container) {
    container.innerHTML = `
      <p>This feature will show detailed session information and will be implemented in the next version.</p>
    `;
  }
  
  // Render pages view
  renderPages(container) {
    container.innerHTML = `
      <p>This feature will show detailed page analytics and will be implemented in the next version.</p>
    `;
  }
  
  // Show the dashboard
  show() {
    if (this.container) {
      this.container.style.display = 'flex';
      if (!this.analyticsData) {
        this.loadData();
      }
    }
    return this;
  }
  
  // Hide the dashboard
  hide() {
    if (this.container) {
      this.container.style.display = 'none';
    }
    return this;
  }
  
  // Format time in seconds to readable string
  formatTime(seconds) {
    if (seconds < 60) {
      return `${seconds} sec`;
    } else if (seconds < 3600) {
      const minutes = Math.floor(seconds / 60);
      return `${minutes} min`;
    } else {
      const hours = Math.floor(seconds / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
      return `${hours}h ${minutes}m`;
    }
  }
  
  // Calculate percentage
  calculatePercentage(value, total) {
    if (!total) return 0;
    return Math.round((value / total) * 100);
  }
}

// Create and start tracking
const userTracker = new UserTracker();
userTracker.start();

// Make objects available globally
window.userTracker = userTracker;
window.HeatmapVisualizer = HeatmapVisualizer;
window.AnalyticsDashboard = AnalyticsDashboard;

// Helper function to create heatmap
window.createHeatmap = function(options) {
  const visualizer = new HeatmapVisualizer(userTracker);
  visualizer.createHeatmap(options);
  return visualizer;
};

// Helper function to show analytics dashboard
window.showAnalytics = function() {
  const dashboard = new AnalyticsDashboard();
  dashboard.show();
  return dashboard;
};

// Add keyboard shortcut Alt+A to show analytics (for admins)
document.addEventListener('keydown', function(e) {
  // Alt+A
  if (e.altKey && e.key === 'a') {
    window.showAnalytics();
  }
});