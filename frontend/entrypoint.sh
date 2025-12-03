#!/bin/sh

# Inject TURN server IP into window object for runtime access
# This allows Angular to read the environment variable at runtime
if [ -n "$WEBRTC_TURN_IP" ]; then
  # Create a script that sets the TURN server IP in window object
  # This will be served as a static file
  cat > /app/dist/inject-config.js <<EOF
(function() {
  if (typeof window !== 'undefined') {
    window.__TURN_SERVER_IP__ = '$WEBRTC_TURN_IP';
  }
})();
EOF
  # Inject the script into index.html if it exists
  if [ -f /app/dist/index.html ]; then
    # Check if script is already injected, if not add it before </head>
    if ! grep -q "inject-config.js" /app/dist/index.html; then
      sed -i 's|</head>|<script src="/inject-config.js"></script></head>|' /app/dist/index.html
    fi
  fi
fi

# Start the server
exec serve -s dist -l 80

