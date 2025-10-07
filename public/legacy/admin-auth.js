// Admin Authentication Protection Script
// Include this script at the top of any admin page to protect it

(function() {
    'use strict';
    
    // Session Management Constants
    const SESSION_KEY = "tpusa_admin_session";
    const SESSION_TIMEOUT = 2 * 60 * 60 * 1000; // 2 hours in milliseconds
    
    // Check if admin is authenticated
    function isAdminAuthenticated() {
        try {
            const session = sessionStorage.getItem(SESSION_KEY);
            if (!session) return false;
            
            const sessionData = JSON.parse(session);
            const now = Date.now();
            
            // Check if session has expired
            if (now > sessionData.expires) {
                clearAdminSession();
                return false;
            }
            
            // Extend session on activity
            extendSession();
            return true;
        } catch (e) {
            console.error('Session check error:', e);
            clearAdminSession();
            return false;
        }
    }
    
    function clearAdminSession() {
        try {
            sessionStorage.removeItem(SESSION_KEY);
        } catch (e) {
            console.error('Failed to clear session:', e);
        }
    }
    
    function extendSession() {
        try {
            const session = sessionStorage.getItem(SESSION_KEY);
            if (session) {
                const sessionData = JSON.parse(session);
                sessionData.expires = Date.now() + SESSION_TIMEOUT;
                sessionStorage.setItem(SESSION_KEY, JSON.stringify(sessionData));
            }
        } catch (e) {
            console.error('Failed to extend session:', e);
        }
    }
    
    // Main protection function
    function requireAdminAuth() {
        if (!isAdminAuthenticated()) {
            console.log('Admin access required - redirecting to login');
            
            // Store the current page for redirect after login
            const currentPage = window.location.pathname.split('/').pop() || 'index.html';
            sessionStorage.setItem('tpusa_return_page', currentPage);
            
            // Redirect to home page for login
            window.location.href = 'home.html';
            return false;
        }
        return true;
    }
    
    // Add logout functionality
    function addLogoutButton() {
        // Only add if not already present
        if (document.querySelector('.admin-logout-btn')) return;
        
        const logoutBtn = document.createElement('button');
        logoutBtn.className = 'admin-logout-btn';
        logoutBtn.innerHTML = '🚪 Logout';
        logoutBtn.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 9999;
            background: #dc2626;
            color: white;
            border: none;
            padding: 8px 16px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 0.875rem;
            font-weight: 500;
            box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
            transition: all 0.2s ease;
        `;
        
        logoutBtn.addEventListener('mouseenter', function() {
            this.style.background = '#b91c1c';
            this.style.transform = 'translateY(-1px)';
        });
        
        logoutBtn.addEventListener('mouseleave', function() {
            this.style.background = '#dc2626';
            this.style.transform = 'translateY(0)';
        });
        
        logoutBtn.addEventListener('click', function() {
            if (confirm('Are you sure you want to logout?')) {
                clearAdminSession();
                window.location.href = 'home.html';
            }
        });
        
        document.body.appendChild(logoutBtn);
    }
    
    // Add session timeout warning
    function addSessionWarning() {
        let warningShown = false;
        
        setInterval(() => {
            const session = sessionStorage.getItem(SESSION_KEY);
            if (session) {
                try {
                    const sessionData = JSON.parse(session);
                    const timeLeft = sessionData.expires - Date.now();
                    
                    // Warn when 10 minutes left
                    if (timeLeft < 10 * 60 * 1000 && timeLeft > 0 && !warningShown) {
                        warningShown = true;
                        const minutes = Math.ceil(timeLeft / 60 / 1000);
                        
                        if (confirm(`Your session will expire in ${minutes} minutes. Click OK to extend your session.`)) {
                            extendSession();
                            warningShown = false;
                        }
                    }
                    
                    // Auto-logout when expired
                    if (timeLeft <= 0) {
                        clearAdminSession();
                        alert('Your session has expired. Please login again.');
                        window.location.href = 'home.html';
                    }
                } catch (e) {
                    console.error('Session warning error:', e);
                }
            }
        }, 60 * 1000); // Check every minute
    }
    
    // Initialize protection immediately
    if (!requireAdminAuth()) {
        return; // Page will redirect, stop execution
    }
    
    // Add logout button and session management once page loads
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
            addLogoutButton();
            addSessionWarning();
        });
    } else {
        addLogoutButton();
        addSessionWarning();
    }
    
    console.log('Admin authentication initialized');
    
})();