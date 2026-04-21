import { eventHandler } from "vinxi/http"

import { GoogleFonts, renderHTML } from "@rio.js/vinxi/render"

const GOOGLE_FONTS = [
  {
    name: "DM Serif Display",
    styles: "ital@0;1",
  },
  {
    name: "Instrument Sans",
    styles: "ital,wght@0,400;0,500;0,600;0,700;1,400;1,500",
  },
  {
    name: "JetBrains Mono",
    styles: "wght@400;500",
  },
]

const STYLE = `
/* Ensure font is loaded */
      @import url('https://fonts.googleapis.com/css2?family=Caveat:wght@400;500;600;700&display=swap');

      .bg-world-map {
        background-image: url('/map.webp');
        background-size: cover;
        background-position: center center;
        background-repeat: no-repeat;
        position: relative;
      }

      // .bg-world-map::before {
      //   content: '';
      //   position: absolute;
      //   top: 0;
      //   left: 0;
      //   right: 0;
      //   bottom: 0;
      //   background: linear-gradient(135deg, rgba(248, 250, 252, 0.4) 0%, rgba(241, 245, 249, 0.45) 100%);
      //   backdrop-filter: blur(1px);
      // }

      html, body {
        margin: 0;
        padding: 0;
        background: white;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      }

      body {
        margin: 0;
        background-color: #ffffff;
      }

      #root {
        width: 100%;
        min-height: 100vh;
        position: relative;
        background-color: #ffffff;
      }

      #boot-screen-container {
        position: fixed;
        left: 50%;
        top: 50%;
        z-index: 9999;
        transform: translate(-50%, -50%);
        opacity: 1;
        transition: opacity 0.5s ease-out;
      }

      #boot-screen-container.hidden {
        display: none;
      }

      #boot-screen-card {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 2rem;
        max-width: 600px;
        min-width: 450px;
        text-align: center;
        padding: 2rem 3rem;
        background: rgba(255, 255, 255, 0.88);
        backdrop-filter: blur(15px);
        border-radius: 20px;
        box-shadow: 0 25px 70px rgba(0, 0, 0, 0.25), 0 10px 30px rgba(0, 0, 0, 0.15);
        border: 1px solid rgba(255, 255, 255, 0.4);
        position: relative;
        animation: fadeInUp 0.6s ease-out;
      }

      @keyframes fadeInUp {
        from {
          opacity: 0;
          transform: translateY(20px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      #boot-screen-logo-container {
        display: flex;
        align-items: center;
        gap: 6px;
        animation: logoFloat 0.8s ease-out;
        width: 100%;
        justify-content: center;
        min-width: 400px;
      }

      @keyframes logoFloat {
        from {
          opacity: 0;
          transform: translateY(-20px) scale(0.9);
        }
        to {
          opacity: 1;
          transform: translateY(0) scale(1);
        }
      }

      #boot-screen-logo {
        width: 56px;
        height: 56px;
        object-fit: contain;
        filter: drop-shadow(0 4px 8px rgba(0, 0, 0, 0.1));
        animation: logoPulse 3s ease-in-out infinite;
        flex-shrink: 0;
      }

      @keyframes logoPulse {
        0%, 100% { transform: scale(1); }
        50% { transform: scale(1.05); }
      }

      #boot-screen-title {
        font-size: 40px;
        font-weight: 700;
        background: linear-gradient(135deg, #14b8a6 0%, #3b82f6 100%);
        background-clip: text;
        -webkit-background-clip: text;
        color: transparent;
        font-family: Caveat, cursive, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        letter-spacing: -0.01em;
        white-space: nowrap;
        flex-shrink: 0;
        min-width: 220px;
        font-display: swap;
      }

      /* Font loading optimization */
      @font-face {
        font-family: 'Caveat';
        font-style: normal;
        font-weight: 700;
        font-display: swap;
        src: url('https://fonts.gstatic.com/s/caveat/v18/WnznHAc5bAfYB2QRah7pcpNvOx-pjfJ9SIE.woff2') format('woff2');
        unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+2000-206F, U+2074, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
      }

      #boot-screen-status-container {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.5rem;
        min-height: 60px;
      }

      #boot-screen-status {
        font-size: 18px;
        font-weight: 600;
        color: #1f2937;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        animation: fadeInUp 0.6s ease-out 0.2s both;
      }

      #boot-screen-substatus {
        font-size: 14px;
        color: #6b7280;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        animation: fadeInUp 0.6s ease-out 0.4s both;
        opacity: 0.8;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
      }

      .loading-dots {
        display: inline-flex;
        gap: 4px;
        margin-left: 8px;
      }

      .loading-dots span {
        width: 4px;
        height: 4px;
        border-radius: 50%;
        background: #6b7280;
        animation: dotBounce 1.4s ease-in-out infinite;
      }

      .loading-dots span:nth-child(2) { animation-delay: 0.2s; }
      .loading-dots span:nth-child(3) { animation-delay: 0.4s; }

      @keyframes dotBounce {
        0%, 60%, 100% { transform: translateY(0); }
        30% { transform: translateY(-8px); }
      }

      /* Progress bar container */
      #boot-screen-progress-container {
        width: 320px;
        height: 6px;
        background: linear-gradient(90deg, #f1f5f9 0%, #e2e8f0 100%);
        border-radius: 3px;
        overflow: hidden;
        animation: fadeInUp 0.6s ease-out 0.6s both;
        position: relative;
      }

      #boot-screen-progress-bar {
        height: 100%;
        border-radius: 3px;
        background: linear-gradient(90deg, #10b981 0%, #3b82f6 50%, #8b5cf6 100%);
        background-size: 200% 100%;
        width: 0%;
        transition: width 0.8s cubic-bezier(0.4, 0, 0.2, 1);
        position: relative;
        overflow: hidden;
      }

      #boot-screen-progress-bar::after {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.4) 50%, transparent 100%);
        animation: progressShine 2s ease-in-out infinite;
      }

      @keyframes progressShine {
        0% { transform: translateX(-100%); }
        100% { transform: translateX(400%); }
      }

      /* Responsive design */
      @media (max-width: 640px) {
        #boot-screen-card {
          width: 92vw;
          max-width: 450px;
          min-width: 340px;
          padding: 1.5rem 2rem;
        }

      #boot-screen-title {
          font-size: 32px;
        }

        #boot-screen-logo {
          width: 48px;
          height: 48px;
        }

        #boot-screen-progress-container {
          width: 280px;
        }
      }

      @media (max-width: 480px) {
        #boot-screen-title {
          font-size: 28px;
        }

        #boot-screen-card {
          padding: 1.5rem 1.5rem;
        }

        #boot-screen-logo {
          width: 40px;
          height: 40px;
        }
      }
`

const LOADING = `
      // Global loading screen controller
      window.SmartMarketLoader = {
        isLoading: true,
        currentProgress: 0,
        isCompleting: false,
        progressTimeouts: [],

        hide: function() {
          const container = document.getElementById('boot-screen-container');
          if (container && this.isLoading) {
            this.isLoading = false;
            container.classList.add('hidden');
          }
        },

        show: function() {
          const container = document.getElementById('boot-screen-container');
          if (container) {
            this.isLoading = true;
            container.classList.remove('hidden');
          }
        },

        updateStatus: function(status, substatus) {
          const statusEl = document.getElementById('boot-screen-status');
          const substatusEl = document.querySelector('#boot-screen-substatus span');
          if (statusEl && status) statusEl.textContent = status;
          if (substatusEl && substatus) substatusEl.textContent = substatus;
        },

        updateProgress: function(percentage) {
          const progressBar = document.getElementById('boot-screen-progress-bar');
          if (progressBar && percentage >= this.currentProgress) { // Only allow forward progress
            this.currentProgress = percentage;
            progressBar.style.width = percentage + '%';
          }
        },

        clearProgressTimeouts: function() {
          this.progressTimeouts.forEach(timeout => clearTimeout(timeout));
          this.progressTimeouts = [];
        },

        completeLoading: function() {
          if (this.isCompleting || !this.isLoading) return;
          this.isCompleting = true;

          // Clear any pending progress updates
          this.clearProgressTimeouts();

          // Ensure we're at least at 70% before starting completion
          const startProgress = Math.max(this.currentProgress, 70);
          const targetProgress = 100;
          const duration = 1200; // 1.2 seconds
          const startTime = Date.now();

          const animateProgress = () => {
            const elapsed = Date.now() - startTime;
            const progress = Math.min(elapsed / duration, 1);
            const easeOutProgress = 1 - Math.pow(1 - progress, 3); // Ease out cubic

            const currentValue = startProgress + (targetProgress - startProgress) * easeOutProgress;
            this.updateProgress(currentValue);

            // Update status based on progress
            if (currentValue < 80) {
              this.updateStatus('Loading application', 'Preparing interface...');
            } else if (currentValue < 90) {
              this.updateStatus('Rendering map', 'Initializing geography...');
            } else if (currentValue < 98) {
              this.updateStatus('Finalizing setup', 'Almost ready...');
            } else {
              this.updateStatus('Ready!', 'Welcome to SmartMarket');
            }

            if (progress < 1) {
              requestAnimationFrame(animateProgress);
            } else {
              // Wait a moment for user to see completion, then hide
              setTimeout(() => {
                const rootElement = document.getElementById('root');
                if (rootElement) {
                  rootElement.classList.remove('bg-world-map');
                }
                this.hide();
              }, 400);
            }
          };

          requestAnimationFrame(animateProgress);
        }
      };

      // Watch for app readiness and manage loading completion
      function watchForAppReadiness() {
        const rootElement = document.getElementById('root');
        if (!rootElement) return;

        console.log('Starting to watch for app readiness...');

        // Initialize progress
        window.SmartMarketLoader.updateProgress(5);
        window.SmartMarketLoader.updateStatus('Initializing workspace', 'Setting up environment...');

        // Progressive loading simulation based on typical app loading phases
        window.SmartMarketLoader.progressTimeouts.push(setTimeout(() => {
          if (!window.SmartMarketLoader.isCompleting) {
            window.SmartMarketLoader.updateProgress(15);
            window.SmartMarketLoader.updateStatus('Loading framework', 'Preparing components...');
          }
        }, 300));

        window.SmartMarketLoader.progressTimeouts.push(setTimeout(() => {
          if (!window.SmartMarketLoader.isCompleting) {
            window.SmartMarketLoader.updateProgress(28);
            window.SmartMarketLoader.updateStatus('Connecting services', 'Establishing connections...');
          }
        }, 800));

        window.SmartMarketLoader.progressTimeouts.push(setTimeout(() => {
          if (!window.SmartMarketLoader.isCompleting) {
            window.SmartMarketLoader.updateProgress(45);
            window.SmartMarketLoader.updateStatus('Loading map data', 'Fetching geographic data...');
          }
        }, 1400));

        window.SmartMarketLoader.progressTimeouts.push(setTimeout(() => {
          if (!window.SmartMarketLoader.isCompleting) {
            window.SmartMarketLoader.updateProgress(62);
            window.SmartMarketLoader.updateStatus('Preparing interface', 'Building components...');
          }
        }, 2200));

        // Watch for React content being rendered
        const observer = new MutationObserver((mutations) => {
          mutations.forEach((mutation) => {
            if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
              // Check if meaningful React content has been added
              const hasAppContent = rootElement.children.length > 0;
              const hasSignificantContent = Array.from(rootElement.children).some(child =>
                child.nodeType === Node.ELEMENT_NODE &&
                (child.children.length > 0 || child.textContent.trim().length > 0)
              );

              if (hasAppContent && hasSignificantContent && window.SmartMarketLoader.isLoading) {
                console.log('React content detected, starting completion sequence...');

                // Start the completion sequence
                window.SmartMarketLoader.completeLoading();
                observer.disconnect();
                clearInterval(checkInterval);
                clearTimeout(fallbackTimeout);
              }
            }
          });
        });

        // Watch for DOM changes in the root
        observer.observe(rootElement, {
          childList: true,
          subtree: true
        });

        // Also check periodically for more complex app readiness indicators
        const checkInterval = setInterval(() => {
          // Check if app is actually ready and has rendered meaningful content
          const hasAppContent = rootElement.children.length > 0;
          const hasCanvas = document.querySelector('canvas');
          const hasMapContent = document.querySelector('[class*="map"], .mapboxgl-map, .mapbox-map, [data-testid*="map"]');
          const hasRouterContent = document.querySelector('[data-testid], [class*="route"], main, section');

          console.log('hasAppContent', hasAppContent);
          console.log('hasCanvas', hasCanvas);
          console.log('hasMapContent', hasMapContent);
          console.log('hasRouterContent', hasRouterContent);
          console.log('window.SmartMarketLoader.isLoading', window.SmartMarketLoader.isLoading);
          if ((hasAppContent && (hasCanvas || hasMapContent || hasRouterContent)) && window.SmartMarketLoader.isLoading) {
            console.log('App appears fully ready (found interactive content), starting completion...');
            window.SmartMarketLoader.completeLoading();
            observer.disconnect();
            clearInterval(checkInterval);
            clearTimeout(fallbackTimeout);
          }
        }, 750);

        // Fallback timeout - only as last resort (much longer)
        const fallbackTimeout = setTimeout(() => {
          if (window.SmartMarketLoader.isLoading) {
            console.warn('Loading screen timeout - forcing completion after 30 seconds');
            window.SmartMarketLoader.completeLoading();
          }
          observer.disconnect();
          clearInterval(checkInterval);
        }, 30000);
      }

      // Start watching when DOM is ready
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', watchForAppReadiness);
      } else {
        watchForAppReadiness();
      }
      `
function getCanonicalUrl(event: import("vinxi/http").HTTPEvent): string {
  const pathname =
    (event.node.req.url?.split("?")[0] ?? "/").replace(/\/+$/, "") || "/"
  return `https://smartmarket.io${pathname}`
}

export default eventHandler((event) => {
  const canonicalUrl = getCanonicalUrl(event)
  return renderHTML(({ headPrepend, head, scripts, env }) => (
    <html
      lang="en"
      className="light"
      style={{
        colorScheme: "light",
      }}
    >
      <head>
        {headPrepend}
        <link rel="canonical" href={canonicalUrl} />
        <GoogleFonts fonts={GOOGLE_FONTS} />
        <meta charSet="UTF-8" />
        <link rel="icon" type="image/svg+xml" href={env.PUBLIC_APP_FAVICON} />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />

        {/* Primary Meta Tags */}
        <title>
          SmartMarket | Market Intelligence Platform for FMCG, Retail &amp; QSR
        </title>
        <meta
          name="description"
          content="SmartMarket combines enterprise data with location intelligence to power expansion strategy, distribution optimization, and revenue prediction for FMCG, Retail, and QSR businesses."
        />
        <meta
          name="keywords"
          content="market intelligence, location analytics, site selection, distribution optimization, FMCG analytics, retail expansion, QSR site selection, beat planning, route optimization, white space analysis"
        />
        <meta name="robots" content="index, follow" />

        {/* Open Graph */}
        <meta property="og:type" content="website" />
        <meta
          property="og:title"
          content="SmartMarket | Market Intelligence Platform"
        />
        <meta
          property="og:description"
          content="Market intelligence platform combining enterprise data with location intelligence for FMCG, Retail, and QSR."
        />
        <meta property="og:image" content="/og-image.png" />

        {/* Twitter Card */}
        <meta name="twitter:card" content="summary_large_image" />
        <meta
          name="twitter:title"
          content="SmartMarket | Market Intelligence Platform"
        />
        <meta
          name="twitter:description"
          content="Data-driven market intelligence for smarter growth."
        />
        <meta name="twitter:image" content="/og-image.png" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin=""
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Caveat:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
        {/* <link
          href="https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&family=Quicksand:wght@300..700&display=swap"
          rel="stylesheet"
        /> */}
        <link
          href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@300;400;500;600;700;800;900&family=Google+Sans:wght@400;500;700&display=swap"
          rel="stylesheet"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Roboto%20Mono:wght@100..900&family=Quantico:ital,wght@0,400;0,700;1,400;1,700&display=swap"
          rel="stylesheet"
        ></link>
        <link
          href="https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=Instrument+Sans:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
        <style dangerouslySetInnerHTML={{ __html: STYLE }} />
        {head}
      </head>
      <body>
        <div id="root" className="bg-world-map"></div>
        {/* <div id="boot-screen-container">
          <div id="boot-screen-card">
            <div id="boot-screen-logo-container">
              <img src="/sm-logo.png" alt="SmartMarket" id="boot-screen-logo" />
              <div id="boot-screen-title">SmartMarket</div>
            </div>
            <div id="boot-screen-status-container">
              <div id="boot-screen-status">Initializing workspace</div>
              <div id="boot-screen-substatus">
                <span>Setting up environment...</span>
                <span className="loading-dots">
                  <span></span>
                  <span></span>
                  <span></span>
                </span>
              </div>
            </div>
            <div id="boot-screen-progress-container">
              <div id="boot-screen-progress-bar"></div>
            </div>
          </div>
        </div> */}
        {/* <script dangerouslySetInnerHTML={{ __html: LOADING }} /> */}
        {scripts}
      </body>
    </html>
  ))(event)
})
