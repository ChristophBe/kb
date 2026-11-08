# Dex, the dev OIDC identity provider (rendered with gomplate by the image's
# entrypoint because of the .tpl suffix). Not for production: static users,
# known passwords, and the password grant enabled for tests and scripts.
issuer: {{ getenv "KB_OIDC_ISSUER" "http://localhost:5556/dex" }}

# Keeps the signing keys across restarts, so issued tokens stay valid.
storage:
  type: sqlite3
  config:
    file: /var/dex/dex.db

web:
  http: 0.0.0.0:5556
  allowedOrigins: ["*"]

oauth2:
  # password: fetch a token without a browser (tests, scripts, grpcurl).
  grantTypes: [authorization_code, refresh_token, password]
  responseTypes: [code]
  skipApprovalScreen: true
  passwordConnector: local

expiry:
  idTokens: 24h

enablePasswordDB: true

# Every user's password is "password".
staticPasswords:
  - email: alice@example.com
    username: alice
    userID: alice
    hash: "$2a$10$2b2cU8CPhOTaGrs1HRQuAueS7JTT5ZHsHSzYiFPm1leZck7Mc8T4W"
  - email: bob@example.com
    username: bob
    userID: bob
    hash: "$2a$10$2b2cU8CPhOTaGrs1HRQuAueS7JTT5ZHsHSzYiFPm1leZck7Mc8T4W"

staticClients:
  # The web shell: a public client using the authorization code flow with PKCE.
  - id: kb-web
    name: kb
    public: true
    redirectURIs:
      - http://localhost:{{ getenv "KB_WEB_PORT" "3000" }}/
      - http://localhost:{{ getenv "KB_WEB_PORT" "3000" }}/auth/callback
      - http://localhost:5173/
      - http://localhost:5173/auth/callback
  # Command-line tools and tests, with the password grant.
  - id: kb-cli
    name: kb CLI
    public: true
    redirectURIs: [http://localhost:8000/callback]
