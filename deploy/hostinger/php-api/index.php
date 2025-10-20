<?php
// Simple PHP API for Hostinger shared hosting (no Node)
// Provides minimal endpoints needed by the SPA.

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, PATCH, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');
// Avoid caching of API responses (especially behind LiteSpeed/CDN) and ensure per-user caching separation
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');
header('Expires: 0');
header('Vary: Authorization');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

$config = require __DIR__ . '/config.php';

// Error handlers to surface errors as JSON (debug info only if ?debug=1)
set_exception_handler(function($e){
  $debug = isset($_GET['debug']) && $_GET['debug'] === '1';
  http_response_code(500);
  echo json_encode([
    'error' => 'server',
    'message' => $debug ? ($e->getMessage()) : 'Internal error'
  ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
  exit;
});
set_error_handler(function($severity, $message, $file, $line){
  // Convert PHP errors to exceptions so the handler above responds in JSON
  throw new ErrorException($message, 0, $severity, $file, $line);
});

function db() {
  static $pdo = null; global $config;
  if ($pdo) return $pdo;
  $dsn = 'mysql:host='.$config['db']['host'].';dbname='.$config['db']['name'].';charset=utf8mb4;port='.$config['db']['port'];
  $opts = [
    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
  ];
  $pdo = new PDO($dsn, $config['db']['user'], $config['db']['pass'], $opts);
  if (!empty($config['db']['ssl'])) {
    // Depending on Hostinger, SSL may require specific attributes. Keeping minimal here.
  }
  return $pdo;
}

function json($data, $code = 200) {
  http_response_code($code);
  // Re-assert no-cache on each response
  header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
  header('Pragma: no-cache');
  header('Expires: 0');
  header('Vary: Authorization');
  echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
  exit;
}

// Minimal HS256 JWT (verify + sign)
function base64url_encode($data) { return rtrim(strtr(base64_encode($data), '+/', '-_'), '='); }
function base64url_decode($data) { return base64_decode(strtr($data, '-_', '+/')); }
function jwt_sign($payload) {
  global $config; $header = ['alg'=>'HS256','typ'=>'JWT'];
  $h = base64url_encode(json_encode($header));
  $p = base64url_encode(json_encode($payload));
  $sig = hash_hmac('sha256', "$h.$p", $config['jwt_secret'], true);
  return "$h.$p.".base64url_encode($sig);
}
function jwt_verify($token) {
  global $config; $parts = explode('.', $token);
  if (count($parts) !== 3) return null;
  list($h,$p,$s) = $parts; $sig = base64url_decode($s);
  $calc = hash_hmac('sha256', "$h.$p", $config['jwt_secret'], true);
  if (!hash_equals($sig, $calc)) return null;
  $payload = json_decode(base64url_decode($p), true);
  if (!$payload) return null;
  if (isset($payload['exp']) && time() >= $payload['exp']) return null;
  return $payload;
}

function get_token_payload() {
  $auth = '';
  if (isset($_SERVER['HTTP_AUTHORIZATION'])) $auth = $_SERVER['HTTP_AUTHORIZATION'];
  elseif (isset($_SERVER['Authorization'])) $auth = $_SERVER['Authorization'];
  elseif (function_exists('apache_request_headers')) {
    $headers = apache_request_headers();
    if (isset($headers['Authorization'])) $auth = $headers['Authorization'];
    elseif (isset($headers['authorization'])) $auth = $headers['authorization'];
  } elseif (isset($_SERVER['REDIRECT_HTTP_AUTHORIZATION'])) {
    $auth = $_SERVER['REDIRECT_HTTP_AUTHORIZATION'];
  }
  $token = null;
  if ($auth) {
    if (stripos($auth, 'Bearer ') === 0) $token = trim(substr($auth, 7)); else $token = trim($auth);
  }
  if (!$token && isset($_GET['token'])) $token = trim($_GET['token']);
  if (!$token) return null;
  return jwt_verify($token);
}

$uri = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
// Construire un chemin logique stable pour le router
if (strpos($uri, '/stock/') === 0) { $uri = substr($uri, strlen('/stock')); }
$path = $uri;
if (isset($_GET['route']) && $_GET['route'] !== '') {
  $r = trim($_GET['route']);
  $r = '/'.ltrim($r, '/');
  if (strpos($r, '/api/') !== 0) $r = '/api'.$r;
  $path = $r;
}
$path = rtrim($path, '/'); if ($path === '') $path = '/';
$method = $_SERVER['REQUEST_METHOD'];

// --- Debug route (temporaire): echo path/uri/method/route
if ($path === '/api/_debug') {
  $dbg = [
    'path' => $path,
    'uri' => $uri,
    'method' => $method,
    'route' => isset($_GET['route']) ? $_GET['route'] : null,
    'qs' => $_GET,
  ];
  json($dbg);
}

// --- Diagnostic: test de connexion DB ---
if ($path === '/api/db-ping' && $method === 'GET') {
  try {
    $pdo = db();
    $stmt = $pdo->query('SELECT 1');
    $val = $stmt ? $stmt->fetchColumn() : null;
    json(['ok' => true, 'select1' => (int)$val]);
  } catch (Exception $e) {
    json(['ok' => false, 'error' => 'db', 'message' => $e->getMessage()], 500);
  }
}

// DB info (vérification que l'API parle bien à la base distante MySQL)
if ($path === '/api/db-info' && $method === 'GET') {
  $p = get_token_payload(); if (!$p) json(['error'=>'Token manquant ou invalide'], 401);
  try {
    $pdo = db();
    $dbName = null; $version = null; $host = null;
    try { $r = $pdo->query('SELECT DATABASE() AS db'); $row = $r ? $r->fetch() : null; $dbName = $row ? $row['db'] : null; } catch (Exception $_) {}
    try { $r = $pdo->query('SELECT VERSION() AS v'); $row = $r ? $r->fetch() : null; $version = $row ? $row['v'] : null; } catch (Exception $_) {}
    try { $r = $pdo->query('SELECT @@hostname AS h'); $row = $r ? $r->fetch() : null; $host = $row ? $row['h'] : null; } catch (Exception $_) {}
    json(['driver'=>'mysql','database'=>$dbName,'server_version'=>$version,'server_host'=>$host]);
  } catch (Exception $e) {
    json(['error'=>'db','message'=>$e->getMessage()], 500);
  }
}

// Users count (rapide contrôle de cohérence)
if ($path === '/api/users/count' && $method === 'GET') {
  $p = get_token_payload(); if (!$p) json(['error'=>'Token manquant ou invalide'], 401);
  try {
    $pdo = db();
    $r = $pdo->query('SELECT COUNT(*) AS c FROM users');
    $row = $r ? $r->fetch() : null; $c = $row ? intval($row['c']) : 0;
    json(['count'=>$c]);
  } catch (Exception $e) {
    json(['error'=>'db','message'=>$e->getMessage()], 500);
  }
}

// Routing
if ($path === '/api/version' && $method === 'GET') {
  json(['version' => $config['app_version']]);
}

if ($path === '/api/login' && $method === 'POST') {
  $body = json_decode(file_get_contents('php://input'), true) ?: [];
  // Compat: accepter aussi 'email' ou 'username' si 'identifier' est absent
  $identifier = '';
  if (isset($body['identifier']) && trim((string)$body['identifier']) !== '') {
    $identifier = trim((string)$body['identifier']);
  } elseif (isset($body['email']) && trim((string)$body['email']) !== '') {
    $identifier = trim((string)$body['email']);
  } elseif (isset($body['username']) && trim((string)$body['username']) !== '') {
    $identifier = trim((string)$body['username']);
  }
  $password = isset($body['password']) ? (string)$body['password'] : '';
  if (!$identifier || !$password) json(['message'=>'Identifiants requis'], 400);
  $pdo = db();
  // Ne pas référencer une colonne éventuellement absente comme p.entreprise
  $stmt = $pdo->prepare("SELECT u.id, u.email, u.password, p.username, p.role, p.status FROM users u LEFT JOIN profiles p ON u.id = p.user_id WHERE u.email = ? OR p.username = ? LIMIT 1");
  $stmt->execute([$identifier, $identifier]);
  $u = $stmt->fetch();
  if (!$u) json(['message' => 'Utilisateur introuvable'], 404);
  // Attention: si les mots de passe sont hashés bcrypt côté Node, ici il faut password_verify
  if (!password_verify($password, $u['password'])) json(['message' => 'Mot de passe incorrect'], 401);
  $payload = ['id'=>$u['id'],'email'=>$u['email'],'username'=>$u['username'],'iat'=>time(),'exp'=>time()+7200];
  $token = jwt_sign($payload);
  json(['token'=>$token, 'user'=>[
    'id'=>$u['id'], 'email'=>$u['email'], 'username'=>$u['username'], 'role'=>$u['role'] ?: 'user', 'status'=>$u['status'] ?: 'active', 'entreprise'=>''
  ]]);
}

// Register (création d'un utilisateur + profil)
if ($path === '/api/register' && $method === 'POST') {
  $body = json_decode(file_get_contents('php://input'), true) ?: [];
  $full_name = isset($body['full_name']) ? trim($body['full_name']) : '';
  $email = isset($body['email']) ? trim($body['email']) : '';
  $username = isset($body['username']) ? trim($body['username']) : '';
  $password = isset($body['password']) ? (string)$body['password'] : '';
  // 'entreprise' est optionnel et peut ne pas exister en base; on l'ignore côté insertion
  $entreprise = isset($body['entreprise']) ? trim((string)$body['entreprise']) : null;

  if ($full_name === '' || $email === '' || $username === '' || $password === '') {
    json(['message' => 'full_name, email, username et password sont requis'], 400);
  }
  if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
    json(['message' => 'Email invalide'], 400);
  }
  if (strlen($password) < 6) {
    json(['message' => 'Mot de passe trop court (min 6)'], 400);
  }
  if (!preg_match('/^[A-Za-z0-9_.-]{3,}$/', $username)) {
    json(['message' => 'Username invalide (min 3, lettres/chiffres/._-)'], 400);
  }

  $pdo = db();
  try {
    $pdo->beginTransaction();
    // Unicité
    $stmt = $pdo->prepare('SELECT id FROM users WHERE email = ? LIMIT 1');
    $stmt->execute([$email]);
    if ($stmt->fetch()) { $pdo->rollBack(); json(['message' => 'Email déjà utilisé'], 409); }

    $stmt = $pdo->prepare('SELECT user_id FROM profiles WHERE username = ? LIMIT 1');
    $stmt->execute([$username]);
    if ($stmt->fetch()) { $pdo->rollBack(); json(['message' => 'Username déjà utilisé'], 409); }

    // Hash
    $hash = password_hash($password, PASSWORD_BCRYPT);
    // Insert user
    $stmt = $pdo->prepare('INSERT INTO users (full_name, email, password, created_at) VALUES (?, ?, ?, NOW())');
    $stmt->execute([$full_name, $email, $hash]);
    $uid = (int)$pdo->lastInsertId();

  // Insert profile (sans colonne "entreprise" qui peut ne pas exister)
  $stmt = $pdo->prepare('INSERT INTO profiles (user_id, username, role, status) VALUES (?, ?, ?, ?)');
  $stmt->execute([$uid, $username, 'user', 'active']);

    $pdo->commit();
    $payload = ['id'=>$uid,'email'=>$email,'username'=>$username,'iat'=>time(),'exp'=>time()+7200];
    $token = jwt_sign($payload);
    json(['token'=>$token, 'user'=>[
      'id'=>$uid, 'email'=>$email, 'username'=>$username, 'role'=>'user', 'status'=>'active', 'entreprise'=>''
    ]], 201);
  } catch (Exception $e) {
    try { $pdo->rollBack(); } catch (Exception $_) {}
    // Conflits uniques éventuels
    $msg = $e->getMessage();
    if (stripos($msg, 'duplicate') !== false || stripos($msg, 'unique') !== false) {
      json(['message' => 'Conflit de données (email ou username déjà utilisés)'], 409);
    }
    json(['message' => 'Erreur serveur', 'error' => $msg], 500);
  }
}

if ($path === '/api/me' && $method === 'GET') {
  $p = get_token_payload(); if (!$p) json(['error'=>'Token manquant ou invalide'], 401);
  $pdo = db();
  // Ne pas sélectionner p.entreprise si la colonne n'existe pas
  $stmt = $pdo->prepare("SELECT u.id, u.email, p.username, p.role, p.status FROM users u LEFT JOIN profiles p ON u.id=p.user_id WHERE u.id = ? LIMIT 1");
  $stmt->execute([$p['id']]);
  $u = $stmt->fetch(); if (!$u) json(['error'=>'Utilisateur introuvable'], 404);
  json(['user'=>[
    'id'=>$u['id'], 'email'=>$u['email'], 'username'=>$u['username'], 'role'=>$u['role'] ?: 'user', 'status'=>$u['status'] ?: 'active', 'entreprise'=>''
  ]]);
}

if ($path === '/api/clients/count' && $method === 'GET') {
  $p = get_token_payload(); if (!$p) json(['error'=>'Token manquant ou invalide'], 401);
  $pdo = db();
  $stmt = $pdo->prepare("SELECT COUNT(*) as c FROM stock_clients WHERE user_id = ?");
  $stmt->execute([$p['id']]);
  $row = $stmt->fetch();
  json(['count' => intval($row ? $row['c'] : 0)]);
}

if ($path === '/api/designations/count' && $method === 'GET') {
  $p = get_token_payload(); if (!$p) json(['error'=>'Token manquant ou invalide'], 401);
  $pdo = db();
  $stmt = $pdo->prepare("SELECT COUNT(*) as c FROM stock_designations WHERE user_id = ?");
  $stmt->execute([$p['id']]);
  $row = $stmt->fetch();
  json(['count' => intval($row ? $row['c'] : 0)]);
}

if ($path === '/api/clients/search' && $method === 'GET') {
  $p = get_token_payload(); if (!$p) json(['error'=>'Token manquant ou invalide'], 401);
  $q = isset($_GET['q']) ? trim($_GET['q']) : '';
  $pdo = db();
  if ($q === '') json([]);
  $stmt = $pdo->prepare("SELECT id, name, address, phone, email FROM stock_clients WHERE user_id = ? AND (name LIKE ? OR phone LIKE ? OR email LIKE ?) ORDER BY name ASC LIMIT 100");
  $like = "%$q%"; $stmt->execute([$p['id'], $like, $like, $like]);
  json($stmt->fetchAll());
}

if ($path === '/api/designations/search' && $method === 'GET') {
  $p = get_token_payload(); if (!$p) json(['error'=>'Token manquant ou invalide'], 401);
  $q = isset($_GET['q']) ? trim($_GET['q']) : '';
  $pdo = db();
  if ($q === '') json([]);
  $stmt = $pdo->prepare("SELECT id, name, current_stock FROM stock_designations WHERE user_id = ? AND (name LIKE ?) ORDER BY name ASC LIMIT 100");
  $like = "%$q%"; $stmt->execute([$p['id'], $like]);
  json($stmt->fetchAll());
}

// Listes complètes (limitées) pour modales: clients et désignations
if ($path === '/api/clients/all' && $method === 'GET') {
  $p = get_token_payload(); if (!$p) json(['error'=>'Token manquant ou invalide'], 401);
  try {
    $pdo = db();
    $q = isset($_GET['q']) ? trim($_GET['q']) : '';
    if ($q !== '') {
      $like = "%$q%";
      $stmt = $pdo->prepare("SELECT id, name, phone, email FROM stock_clients WHERE user_id = ? AND (name LIKE ? OR phone LIKE ? OR email LIKE ?) ORDER BY name ASC LIMIT 100");
      $stmt->execute([$p['id'], $like, $like, $like]);
    } else {
      $stmt = $pdo->prepare("SELECT id, name, phone, email FROM stock_clients WHERE user_id = ? ORDER BY name ASC LIMIT 100");
      $stmt->execute([$p['id']]);
    }
    json($stmt->fetchAll());
  } catch (Exception $e) {
    $msg = $e->getMessage();
    if (stripos($msg, "doesn't exist") !== false || stripos($msg, 'no such table') !== false || stripos($msg, 'exist') !== false) {
      json([]); // table manquante: renvoyer liste vide pour ne pas casser l'UI
    }
    json(['error'=>'db','message'=>$msg], 500);
  }
}

if ($path === '/api/designations/all' && $method === 'GET') {
  $p = get_token_payload(); if (!$p) json(['error'=>'Token manquant ou invalide'], 401);
  try {
    $pdo = db();
    $q = isset($_GET['q']) ? trim($_GET['q']) : '';
    if ($q !== '') {
      $like = "%$q%";
      $stmt = $pdo->prepare("SELECT id, name, current_stock FROM stock_designations WHERE user_id = ? AND (name LIKE ?) ORDER BY name ASC LIMIT 100");
      $stmt->execute([$p['id'], $like]);
    } else {
      $stmt = $pdo->prepare("SELECT id, name, current_stock FROM stock_designations WHERE user_id = ? ORDER BY name ASC LIMIT 100");
      $stmt->execute([$p['id']]);
    }
    json($stmt->fetchAll());
  } catch (Exception $e) {
    $msg = $e->getMessage();
    if (stripos($msg, "doesn't exist") !== false || stripos($msg, 'no such table') !== false || stripos($msg, 'exist') !== false) {
      json([]); // table manquante: renvoyer liste vide pour ne pas casser l'UI
    }
    json(['error'=>'db','message'=>$msg], 500);
  }
}

if ($path === '/api/stockFlux' && $method === 'GET') {
  $p = get_token_payload(); if (!$p) json(['error'=>'Token manquant ou invalide'], 401);
  $date = isset($_GET['date']) ? $_GET['date'] : date('Y-m-d');
  $pdo = db();

  // 1) Mouvements du jour avec libellés et montant
  $sqlMov = "
    SELECT
      'mouvement' AS kind,
      sm.id AS id,
      sm.created_at AS created_at,
      DATE_FORMAT(sm.date,'%Y-%m-%d') AS date,
      sm.type AS type,
      sm.designation_id AS designation_id,
      COALESCE(d.name, 'N/A') AS designation_name,
      sm.quantite AS quantite,
      sm.prix AS prix,
      COALESCE(sm.montant, sm.quantite * sm.prix) AS montant,
      sm.client_id AS client_id,
      COALESCE(c.name, 'N/A') AS client_name,
      sm.stock AS stock,
      sm.stockR AS stockR,
      NULL AS mouvement_id
    FROM stock_mouvements sm
    LEFT JOIN stock_designations d ON d.id = sm.designation_id AND d.user_id = sm.user_id
    LEFT JOIN stock_clients c ON c.id = sm.client_id AND c.user_id = sm.user_id
    WHERE sm.user_id = ? AND DATE(sm.date) = ?
    ORDER BY sm.id ASC";
  $stmt = $pdo->prepare($sqlMov); $stmt->execute([$p['id'], $date]);
  $mouvs = $stmt->fetchAll();

  // 2) Paiements du jour, liés à leurs mouvements pour récupérer type/client/désignation
  $sqlPay = "
    SELECT
      CASE WHEN sm.type = 'entree' THEN 'achat' ELSE 'paiement' END AS kind,
      sp.id AS id,
      sp.created_at AS created_at,
      DATE_FORMAT(sp.date,'%Y-%m-%d') AS date,
      sm.type AS type,
      sm.designation_id AS designation_id,
      COALESCE(d.name, 'N/A') AS designation_name,
      NULL AS quantite,
      NULL AS prix,
      sp.montant AS montant,
      sm.client_id AS client_id,
      COALESCE(c.name, 'N/A') AS client_name,
      NULL AS stock,
      NULL AS stockR,
      sp.mouvement_id AS mouvement_id
    FROM stock_paiements sp
    JOIN stock_mouvements sm ON sm.id = sp.mouvement_id
    LEFT JOIN stock_designations d ON d.id = sm.designation_id AND d.user_id = sm.user_id
    LEFT JOIN stock_clients c ON c.id = sm.client_id AND c.user_id = sm.user_id
    WHERE (sp.user_id = ? OR sp.user_id IS NULL) AND sm.user_id = ? AND DATE(sp.date) = ?
    ORDER BY sp.id ASC";
  $stmt = $pdo->prepare($sqlPay); $stmt->execute([$p['id'], $p['id'], $date]);
  $pays = $stmt->fetchAll();

  // 3) Dépenses du jour (affichées comme lignes de flux)
  $sqlDep = "
    SELECT
      'depense' AS kind,
      sd.id AS id,
      sd.created_at AS created_at,
      DATE_FORMAT(sd.date,'%Y-%m-%d') AS date,
      'depense' AS type,
      NULL AS designation_id,
      sd.libelle AS designation_name,
      NULL AS quantite,
      NULL AS prix,
      sd.montant AS montant,
      NULL AS client_id,
      COALESCE(sd.destinataire, 'N/A') AS client_name,
      NULL AS stock,
      NULL AS stockR,
      NULL AS mouvement_id
    FROM stock_depenses sd
    WHERE sd.user_id = ? AND DATE(sd.date) = ?
    ORDER BY sd.id ASC";
  $stmt = $pdo->prepare($sqlDep); $stmt->execute([$p['id'], $date]);
  $deps = $stmt->fetchAll();

  // Concaténer et calculer balance/solde (ordre croissant pour le cumul)
  $rowsAsc = array_merge($mouvs, $pays, $deps);
  usort($rowsAsc, function($a,$b){
    if ($a['date'] !== $b['date']) return strcmp($a['date'], $b['date']); // asc
    $ca = isset($a['created_at']) ? $a['created_at'] : '';
    $cb = isset($b['created_at']) ? $b['created_at'] : '';
    if ($ca !== $cb) return strcmp($ca, $cb); // asc
    return ($a['id'] <=> $b['id']); // asc
  });

  $running = 0.0; $withBalances = [];
  foreach ($rowsAsc as $r) {
    $montant = isset($r['montant']) ? (float)$r['montant'] : 0.0;
    $balance = 0.0;
    $kind = isset($r['kind']) ? strtolower($r['kind']) : '';
    $type = isset($r['type']) ? strtolower($r['type']) : '';
    if ($kind === 'paiement' && $type === 'sortie') {
      $balance = $montant; // encaissement d'une vente (sortie)
    } elseif ($kind === 'achat' || $kind === 'depense') {
      $balance = -$montant; // achat marchandise ou dépense
    } else {
      $balance = 0.0; // lignes "mouvement" neutres pour la caisse
    }
    $running += $balance;
    $r['balance'] = $balance;
    $r['solde'] = $running;
    $withBalances[] = $r;
  }

  // Sortie en ordre descendant (date, created_at, id) comme le backend Node
  usort($withBalances, function($a,$b){
    if ($a['date'] !== $b['date']) return strcmp($b['date'], $a['date']); // desc
    $ca = isset($a['created_at']) ? $a['created_at'] : '';
    $cb = isset($b['created_at']) ? $b['created_at'] : '';
    if ($ca !== $cb) return strcmp($cb, $ca); // desc
    return ($b['id'] <=> $a['id']); // desc
  });

  // Point de caisse (résumé jour)
  $achats = array_values(array_filter($withBalances, fn($row) => $row['kind'] === 'achat' && $row['date'] === $date));
  $depenses = array_values(array_filter($withBalances, fn($row) => $row['kind'] === 'depense' && $row['date'] === $date));
  $encaissementsDuJour = array_values(array_filter($withBalances, fn($row) => $row['kind'] === 'paiement' && $row['date'] === $date));
  $recouvrements = array_values(array_filter($withBalances, fn($row) => $row['kind'] === 'paiement' && $row['date'] !== $date));

  $totalAchats = array_reduce($achats, fn($s,$r)=> $s + abs((float)$r['montant']), 0.0);
  $totalDepenses = array_reduce($depenses, fn($s,$r)=> $s + abs((float)$r['montant']), 0.0);
  $totalEncaissements = array_reduce($encaissementsDuJour, fn($s,$r)=> $s + (float)$r['montant'], 0.0);
  $totalRecouvrements = array_reduce($recouvrements, fn($s,$r)=> $s + (float)$r['montant'], 0.0);
  $totalEntrees = $totalEncaissements + $totalRecouvrements;
  $totalSorties = $totalAchats + $totalDepenses;
  $soldeCloture = $totalEntrees - $totalSorties;

  json([
    'flux' => $withBalances,
    'pointCaisse' => [
      'date' => $date,
      'achats' => $achats,
      'depenses' => $depenses,
      'encaissementsDuJour' => $encaissementsDuJour,
      'recouvrements' => $recouvrements,
      'totalAchats' => $totalAchats,
      'totalDepenses' => $totalDepenses,
      'totalEncaissements' => $totalEncaissements,
      'totalRecouvrements' => $totalRecouvrements,
      'totalEntrees' => $totalEntrees,
      'totalSorties' => $totalSorties,
      'soldeCloture' => $soldeCloture,
    ]
  ]);
}

// --- Profil: mise à jour du champ entreprise (optionnel si colonne absente)
if ($path === '/api/entreprise' && $method === 'PUT') {
  $p = get_token_payload(); if (!$p) json(['error'=>'Token manquant ou invalide'], 401);
  $body = json_decode(file_get_contents('php://input'), true) ?: [];
  $entreprise = isset($body['entreprise']) ? trim((string)$body['entreprise']) : '';
  try {
    $pdo = db();
    // Tenter update dans profiles si colonne existe
    try {
      $stmt = $pdo->prepare('UPDATE profiles SET entreprise = ? WHERE user_id = ?');
      $stmt->execute([$entreprise, $p['id']]);
      } catch (Exception $e) {
      // Si la colonne n'existe pas, ignorer sans erreur
      if (stripos($e->getMessage(), "doesn't exist") === false && stripos($e->getMessage(), 'unknown column') === false) throw $e;
    }
    json(['entreprise' => $entreprise]);
    } catch (Exception $e) {
    json(['error'=>'db','message'=>$e->getMessage()], 500);
  }
}

// --- Stock Mouvements (minimal pour UI)
if (preg_match('#^/api/stockMouvements(?:/(\d+))?$#', $path, $m)) {
  $p = get_token_payload(); if (!$p) json(['error'=>'Token manquant ou invalide'], 401);
  $pdo = db();
  $id = isset($m[1]) ? intval($m[1]) : 0;

  if ($method === 'GET' && $id === 0) {
    // Filtres simples utilisés par les modales
    $clientId = isset($_GET['client_id']) ? intval($_GET['client_id']) : 0;
    $designationId = isset($_GET['designation_id']) ? intval($_GET['designation_id']) : 0;
    $where = 'sm.user_id = ?'; $params = [$p['id']];
    if ($clientId > 0) { $where .= ' AND sm.client_id = ?'; $params[] = $clientId; }
    if ($designationId > 0) { $where .= ' AND sm.designation_id = ?'; $params[] = $designationId; }
    $sql = "SELECT sm.id,
                   DATE_FORMAT(sm.date,'%Y-%m-%d') as date,
                   sm.type,
                   sm.designation_id,
                   d.name AS designation_name,
                   sm.quantite,
                   sm.prix,
                   sm.client_id,
                   c.name AS client_name,
                   sm.montant,
                   sm.stock,
                   sm.stockR,
                   sm.created_at
            FROM stock_mouvements sm
            LEFT JOIN stock_designations d ON d.id = sm.designation_id AND d.user_id = sm.user_id
            LEFT JOIN stock_clients c ON c.id = sm.client_id AND c.user_id = sm.user_id
            WHERE $where
            ORDER BY sm.date DESC, sm.id DESC
            LIMIT 200";
    try { $stmt = $pdo->prepare($sql); $stmt->execute($params); json($stmt->fetchAll()); }
    catch (Exception $e) {
      $msg = $e->getMessage(); if (stripos($msg, "doesn't exist") !== false || stripos($msg, 'no such table') !== false) json([]);
      json(['error'=>'db','message'=>$msg], 500);
    }
  }

  if ($method === 'POST' && $id === 0) {
    $b = json_decode(file_get_contents('php://input'), true) ?: [];
    // 1) Normalisation date (YYYY-MM-DD) et type
    $rawDate = isset($b['date']) ? trim((string)$b['date']) : date('Y-m-d');
    $date = $rawDate;
    if (preg_match('/^\d{2}\/\d{2}\/\d{4}$/', $rawDate)) {
      // JJ/MM/AAAA -> ISO
      [$dd,$mm,$yy] = array_map('intval', explode('/', $rawDate));
      $date = sprintf('%04d-%02d-%02d', $yy, $mm, $dd);
    }
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) $date = date('Y-m-d');
    $type = strtolower(trim(isset($b['type']) ? (string)$b['type'] : 'entree'));
    $type = (strpos($type, 's') === 0) ? 'sortie' : 'entree';

    // 2) Résolution désignation/client par ID ou par nom
    $designationId = isset($b['designation_id']) ? intval($b['designation_id']) : null;
    $designationName = isset($b['designation_name']) ? trim((string)$b['designation_name']) : '';
    $clientId = isset($b['client_id']) ? intval($b['client_id']) : null;
    $clientName = isset($b['client_name']) ? trim((string)$b['client_name']) : '';

    try {
      $pdo->beginTransaction();

      if (!$designationId && $designationName !== '') {
        // Trouver existante
        $stmt = $pdo->prepare('SELECT id, current_stock FROM stock_designations WHERE user_id = ? AND LOWER(name) = LOWER(?) LIMIT 1');
        $stmt->execute([$p['id'], $designationName]);
        $row = $stmt->fetch();
        if ($row) {
          $designationId = (int)$row['id'];
        } else {
          // Créer
          $stmt = $pdo->prepare('INSERT INTO stock_designations (user_id, name, current_stock, created_at) VALUES (?, ?, 0, NOW())');
          $stmt->execute([$p['id'], $designationName]);
          $designationId = (int)$pdo->lastInsertId();
        }
      }

      if (!$clientId && $clientName !== '') {
        $stmt = $pdo->prepare('SELECT id FROM stock_clients WHERE user_id = ? AND LOWER(name) = LOWER(?) LIMIT 1');
        $stmt->execute([$p['id'], $clientName]);
        $row = $stmt->fetch();
        if ($row) {
          $clientId = (int)$row['id'];
        } else {
          $stmt = $pdo->prepare('INSERT INTO stock_clients (user_id, name, created_at) VALUES (?, ?, NOW())');
          $stmt->execute([$p['id'], $clientName]);
          $clientId = (int)$pdo->lastInsertId();
        }
      }

      // 3) Quantité/prix/montant
      $quantite = isset($b['quantite']) ? (float)$b['quantite'] : 0;
      $prix = isset($b['prix']) ? (float)$b['prix'] : 0;
      if (!is_finite($quantite) || $quantite <= 0) { $pdo->rollBack(); json(['error'=>'Quantité invalide'], 400); }
      if (!is_finite($prix) || $prix < 0) { $pdo->rollBack(); json(['error'=>'Prix invalide'], 400); }
      $montant = round($quantite * $prix, 2);

      // 4) Stock courant et mise à jour
      $stock = null; $stockR = null;
      if ($designationId) {
        $stmt = $pdo->prepare('SELECT current_stock FROM stock_designations WHERE id = ? AND user_id = ? LIMIT 1');
        $stmt->execute([$designationId, $p['id']]);
        $row = $stmt->fetch();
        if (!$row) { $pdo->rollBack(); json(['error'=>'Désignation introuvable'], 404); }
        $stock = (int)$row['current_stock'];
        $stockR = $type === 'entree' ? $stock + (int)$quantite : $stock - (int)$quantite;
        // applique mise à jour sur la désignation
        $stmt = $pdo->prepare('UPDATE stock_designations SET current_stock = ? WHERE id = ? AND user_id = ?');
        $stmt->execute([$stockR, $designationId, $p['id']]);
      }

      // 5) Insertion du mouvement
      $stmt = $pdo->prepare('INSERT INTO stock_mouvements (user_id, date, type, designation_id, quantite, prix, client_id, montant, stock, stockR, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())');
      $stmt->execute([$p['id'], $date, $type, $designationId, $quantite, $prix, $clientId, $montant, $stock, $stockR]);
      $newId = (int)$pdo->lastInsertId();

      $pdo->commit();
      json(['id'=>$newId, 'designation_id'=>$designationId, 'client_id'=>$clientId, 'montant'=>$montant, 'stock'=>$stock, 'stockR'=>$stockR], 201);
    } catch (Exception $e) {
      try { $pdo->rollBack(); } catch (Exception $_) {}
      $msg = $e->getMessage(); json(['error'=>'db','message'=>$msg], 500);
    }
  }

  if ($method === 'PATCH' && $id > 0) {
    $b = json_decode(file_get_contents('php://input'), true) ?: [];
    // Charger l'existant
    try {
      $pdo->beginTransaction();
      $stmt = $pdo->prepare('SELECT id, user_id, date, type, designation_id, quantite, prix, client_id FROM stock_mouvements WHERE id = ? AND user_id = ? LIMIT 1');
      $stmt->execute([$id, $p['id']]);
      $old = $stmt->fetch();
      if (!$old) { $pdo->rollBack(); json(['error'=>'Mouvement introuvable'], 404); }

      // Préparer nouvelles valeurs
      $newDate = isset($b['date']) ? trim((string)$b['date']) : $old['date'];
      if (preg_match('/^\d{2}\/\d{2}\/\d{4}$/', $newDate)) {
        [$dd,$mm,$yy] = array_map('intval', explode('/', $newDate));
        $newDate = sprintf('%04d-%02d-%02d', $yy, $mm, $dd);
      }
      if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $newDate)) $newDate = $old['date'];
      $newType = isset($b['type']) ? (strpos(strtolower($b['type']), 's') === 0 ? 'sortie' : 'entree') : $old['type'];

      $newDesId = array_key_exists('designation_id', $b) ? (is_null($b['designation_id']) ? null : (int)$b['designation_id']) : (int)$old['designation_id'];
      if (!$newDesId && !empty($b['designation_name'])) {
        $name = trim((string)$b['designation_name']);
        if ($name !== '') {
          $stmt = $pdo->prepare('SELECT id FROM stock_designations WHERE user_id = ? AND LOWER(name) = LOWER(?) LIMIT 1');
          $stmt->execute([$p['id'], $name]); $r = $stmt->fetch();
          if ($r) $newDesId = (int)$r['id'];
          else {
            $stmt = $pdo->prepare('INSERT INTO stock_designations (user_id, name, current_stock, created_at) VALUES (?, ?, 0, NOW())');
            $stmt->execute([$p['id'], $name]); $newDesId = (int)$pdo->lastInsertId();
          }
        }
      }

      $newCliId = array_key_exists('client_id', $b) ? (is_null($b['client_id']) ? null : (int)$b['client_id']) : (int)$old['client_id'];
      if (!$newCliId && !empty($b['client_name'])) {
        $name = trim((string)$b['client_name']);
        if ($name !== '') {
          $stmt = $pdo->prepare('SELECT id FROM stock_clients WHERE user_id = ? AND LOWER(name) = LOWER(?) LIMIT 1');
          $stmt->execute([$p['id'], $name]); $r = $stmt->fetch();
          if ($r) $newCliId = (int)$r['id'];
          else { $stmt = $pdo->prepare('INSERT INTO stock_clients (user_id, name, created_at) VALUES (?, ?, NOW())'); $stmt->execute([$p['id'], $name]); $newCliId = (int)$pdo->lastInsertId(); }
        }
      }

      $newQ = array_key_exists('quantite', $b) ? (float)$b['quantite'] : (float)$old['quantite'];
      $newP = array_key_exists('prix', $b) ? (float)$b['prix'] : (float)$old['prix'];
      if (!is_finite($newQ) || $newQ <= 0) { $pdo->rollBack(); json(['error'=>'Quantité invalide'], 400); }
      if (!is_finite($newP) || $newP < 0) { $pdo->rollBack(); json(['error'=>'Prix invalide'], 400); }
      $newMontant = round($newQ * $newP, 2);

      // Mise à jour simple du mouvement (sans recalcul de stock historique)
      $stmt = $pdo->prepare('UPDATE stock_mouvements SET date = ?, type = ?, designation_id = ?, quantite = ?, prix = ?, client_id = ?, montant = ? WHERE id = ? AND user_id = ?');
      $stmt->execute([$newDate, $newType, $newDesId, $newQ, $newP, $newCliId, $newMontant, $id, $p['id']]);

      $pdo->commit();
      json(['ok'=>true, 'montant'=>$newMontant]);
    } catch (Exception $e) {
      try { $pdo->rollBack(); } catch (Exception $_) {}
      json(['error'=>'db','message'=>$e->getMessage()], 500);
    }
  }

  if ($method === 'DELETE' && $id > 0) {
    try { $stmt = $pdo->prepare('DELETE FROM stock_mouvements WHERE id = ? AND user_id = ?'); $stmt->execute([$id, $p['id']]); json(['ok'=>true]); }
    catch (Exception $e) { json(['error'=>'db','message'=>$e->getMessage()], 500); }
  }

  json(['error'=>'Méthode non supportée'], 405);
}

// --- Designations CRUD minimal ---
if (preg_match('#^/api/designations(?:/([0-9]+))?$#', $path, $m)) {
  $p = get_token_payload(); if (!$p) json(['error'=>'Token manquant ou invalide'], 401);
  $pdo = db();
  $id = isset($m[1]) ? intval($m[1]) : 0;

  if ($method === 'GET' && $id > 0) {
    try {
      $stmt = $pdo->prepare('SELECT id, name, current_stock FROM stock_designations WHERE id = ? AND user_id = ? LIMIT 1');
      $stmt->execute([$id, $p['id']]); $row = $stmt->fetch();
      if (!$row) json(['error'=>'Not found'], 404);
      json($row);
    } catch (Exception $e) { json(['error'=>'db','message'=>$e->getMessage()], 500); }
  }

  if ($method === 'POST' && $id === 0) {
    $b = json_decode(file_get_contents('php://input'), true) ?: [];
    $name = isset($b['name']) ? trim($b['name']) : '';
    if ($name === '') json(['error'=>'Nom requis'], 400);
    try {
      $stmt = $pdo->prepare('INSERT INTO stock_designations (user_id, name, current_stock, created_at) VALUES (?, ?, 0, NOW())');
      $stmt->execute([$p['id'], $name]);
      json(['id' => intval($pdo->lastInsertId())], 201);
    } catch (Exception $e) {
      $msg = $e->getMessage();
      if (stripos($msg,'duplicate')!==false || stripos($msg,'unique')!==false) {
        // Retourner l'existant si possible
        try {
          $stmt = $pdo->prepare('SELECT id FROM stock_designations WHERE user_id = ? AND LOWER(name) = LOWER(?) LIMIT 1');
          $stmt->execute([$p['id'], $name]); $r = $stmt->fetch(); if ($r) json(['id'=>intval($r['id'])],200);
        } catch (Exception $_) {}
      }
      json(['error'=>'db','message'=>$msg], 500);
    }
  }

  json(['error'=>'Méthode non supportée'], 405);
}

// --- Clients CRUD minimal ---
if (preg_match('#^/api/clients(?:/([0-9]+))?$#', $path, $m)) {
  $p = get_token_payload(); if (!$p) json(['error'=>'Token manquant ou invalide'], 401);
  $pdo = db();
  $id = isset($m[1]) ? intval($m[1]) : 0;

  if ($method === 'GET' && $id > 0) {
    try {
      $stmt = $pdo->prepare('SELECT id, name, address, phone, email FROM stock_clients WHERE id = ? AND user_id = ? LIMIT 1');
      $stmt->execute([$id, $p['id']]); $row = $stmt->fetch();
      if (!$row) json(['error'=>'Not found'], 404);
      json($row);
    } catch (Exception $e) { json(['error'=>'db','message'=>$e->getMessage()], 500); }
  }

  if ($method === 'POST' && $id === 0) {
    $b = json_decode(file_get_contents('php://input'), true) ?: [];
    $name = isset($b['name']) ? trim($b['name']) : '';
    $address = isset($b['address']) ? trim($b['address']) : '';
    $phone = isset($b['phone']) ? trim($b['phone']) : '';
    $email = isset($b['email']) ? trim($b['email']) : '';
    if ($name === '') json(['error'=>'Nom requis'], 400);
    try {
      $stmt = $pdo->prepare('INSERT INTO stock_clients (user_id, name, contact, address, phone, email, created_at) VALUES (?, ?, NULL, ?, ?, ?, NOW())');
      $stmt->execute([$p['id'], $name, $address, $phone, $email]);
      json(['id' => intval($pdo->lastInsertId())], 201);
    } catch (Exception $e) {
      $msg = $e->getMessage();
      if (stripos($msg,'duplicate')!==false || stripos($msg,'unique')!==false) {
        try {
          $stmt = $pdo->prepare('SELECT id FROM stock_clients WHERE user_id = ? AND LOWER(name) = LOWER(?) LIMIT 1');
          $stmt->execute([$p['id'], $name]); $r = $stmt->fetch(); if ($r) json(['id'=>intval($r['id'])],200);
        } catch (Exception $_) {}
      }
      json(['error'=>'db','message'=>$msg], 500);
    }
  }

  json(['error'=>'Méthode non supportée'], 405);
}

// --- Upload logo (multipart/form-data)
if ($path === '/api/upload-logo' && $method === 'POST') {
  $p = get_token_payload(); if (!$p) json(['error'=>'Token manquant ou invalide'], 401);
  try {
    if (empty($_FILES) || empty($_FILES['file'])) json(['error'=>'Aucun fichier'], 400);
    $f = $_FILES['file']; if ($f['error'] !== UPLOAD_ERR_OK) json(['error'=>'Upload error','code'=>$f['error']], 400);
    $ext = strtolower(pathinfo($f['name'], PATHINFO_EXTENSION));
    if (!in_array($ext, ['png','jpg','jpeg','webp','svg'])) $ext = 'png';
    $dir = __DIR__ . '/../uploads/avatars';
    if (!is_dir($dir)) { @mkdir($dir, 0775, true); }
    $name = 'u'.$p['id'].'-'.date('YmdHis').'.'.$ext;
    $target = $dir . '/' . $name;
    if (!@move_uploaded_file($f['tmp_name'], $target)) { json(['error'=>'Impossible de sauvegarder le fichier'], 500); }
    $url = '/stock/uploads/avatars/'.$name;
    json(['url'=>$url]);
  } catch (Exception $e) {
    json(['error'=>'upload','message'=>$e->getMessage()], 500);
  }
}

// --- Admin stubs / Payments stubs (éviter 404 en mode Hostinger)
if ($path === '/api/admin/users' && $method === 'GET') { json([]); }
if ($path === '/api/payments/wave/initiate' && $method === 'POST') { json(['ok'=>false,'message'=>'Paiement non activé dans ce mode']); }
if ($path === '/api/payments/wave/initiate/self' && $method === 'POST') { json(['ok'=>false,'message'=>'Paiement non activé dans ce mode']); }
if ($path === '/api/payments/wave/webhook' && $method === 'POST') { json(['ok'=>true]); }

// Safe remote-summary for front badge (no Node replication here)
if ($path === '/api/sync/remote-summary' && $method === 'GET') {
  // Toujours une réponse sûre pour éviter les 500 côté UI
  json(['enabled' => false, 'hasUpdates' => false]);
}

// stockPaiements CRUD
if (preg_match('#^/api/stockPaiements(?:/(\d+))?$#', $uri, $m)) {
  $p = get_token_payload(); if (!$p) json(['error'=>'Token manquant ou invalide'], 401);
  $pdo = db();

  // GET /api/stockPaiements?mouvement_id=123
  if ($method === 'GET' && empty($m[1])) {
    $mouvementId = isset($_GET['mouvement_id']) ? intval($_GET['mouvement_id']) : 0;
    if ($mouvementId <= 0) json(['error' => 'Paramètre mouvement_id requis'], 400);

    // Vérifier appartenance du mouvement
    $stmt = $pdo->prepare("SELECT id FROM stock_mouvements WHERE id = ? AND user_id = ? LIMIT 1");
    $stmt->execute([$mouvementId, $p['id']]);
    $mov = $stmt->fetch();
    if (!$mov) json([]); // pas de fuite d'info si mouvement d'autrui

    $stmt = $pdo->prepare(
      "SELECT id, mouvement_id, user_id, DATE_FORMAT(`date`,'%Y-%m-%d') AS date, montant, created_at
         FROM stock_paiements
        WHERE mouvement_id = ?
        ORDER BY `date` ASC, id ASC"
    );
    $stmt->execute([$mouvementId]);
    $rows = $stmt->fetchAll();
    // Normaliser montant en nombre
    foreach ($rows as &$r) { $r['montant'] = (float)$r['montant']; $r['user_name'] = ''; }
    json($rows);
  }

  // POST /api/stockPaiements
  if ($method === 'POST' && empty($m[1])) {
    $body = json_decode(file_get_contents('php://input'), true) ?: [];
    $movId = isset($body['mouvement_id']) ? intval($body['mouvement_id']) : 0;
    $isoDate = isset($body['date']) ? trim($body['date']) : '';
    $amount = isset($body['montant']) ? (float)$body['montant'] : 0;
    if ($movId <= 0) json(['error' => 'mouvement_id invalide'], 400);
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $isoDate)) json(['error' => 'Format de date invalide (YYYY-MM-DD)'], 400);
    if (!is_finite($amount) || $amount <= 0) json(['error' => 'Montant doit être un nombre > 0'], 400);
    $amount = round($amount, 2);

    // Mouvement + montant
    $stmt = $pdo->prepare("SELECT montant FROM stock_mouvements WHERE id = ? AND user_id = ? LIMIT 1");
    $stmt->execute([$movId, $p['id']]);
    $mov = $stmt->fetch();
    if (!$mov) json(['error' => 'Mouvement introuvable'], 404);
    $mouvementMontant = (float)$mov['montant'];

    // Total déjà payé
    $stmt = $pdo->prepare("SELECT COALESCE(SUM(montant),0) AS total FROM stock_paiements WHERE mouvement_id = ?");
    $stmt->execute([$movId]); $sum = $stmt->fetch();
    $dejaPaye = (float)($sum ? $sum['total'] : 0);

    if (($dejaPaye + $amount) - $mouvementMontant > 0.000001) {
      json(['error' => 'Le montant dépasse le reste à payer'], 400);
    }

    $stmt = $pdo->prepare("INSERT INTO stock_paiements (mouvement_id, user_id, montant, `date`) VALUES (?, ?, ?, ?)");
    $stmt->execute([$movId, $p['id'], $amount, $isoDate]);
    $id = (int)$pdo->lastInsertId();

    json([
      'id' => $id,
      'mouvement_id' => $movId,
      'user_id' => $p['id'],
      'date' => $isoDate,
      'montant' => $amount,
      'total_paye' => $dejaPaye + $amount,
      'reste_a_payer' => max($mouvementMontant - ($dejaPaye + $amount), 0)
    ], 201);
  }

  // PATCH /api/stockPaiements/:id
  if ($method === 'PATCH' && !empty($m[1])) {
    $id = intval($m[1]); if ($id <= 0) json(['error' => 'ID invalide'], 400);
    $body = json_decode(file_get_contents('php://input'), true) ?: [];
    $isoDate = isset($body['date']) ? trim($body['date']) : '';
    $hasAmount = array_key_exists('montant', $body);
    $amount = $hasAmount ? (float)$body['montant'] : null;
    if ($isoDate !== '' && !preg_match('/^\d{4}-\d{2}-\d{2}$/', $isoDate)) json(['error' => 'Format de date invalide (YYYY-MM-DD)'], 400);
    if ($hasAmount) {
      if (!is_finite($amount) || $amount <= 0) json(['error' => 'Montant doit être un nombre > 0'], 400);
      $amount = round($amount, 2);
    }

    // Paiement + mouvement et scoping user
    $stmt = $pdo->prepare("SELECT sp.id, sp.mouvement_id, sp.montant, DATE_FORMAT(sp.`date`,'%Y-%m-%d') AS date, sm.montant AS mouvement_montant, sm.user_id
                             FROM stock_paiements sp
                             JOIN stock_mouvements sm ON sm.id = sp.mouvement_id
                            WHERE sp.id = ? LIMIT 1");
    $stmt->execute([$id]); $row = $stmt->fetch();
    if (!$row) json(['error' => 'Paiement introuvable'], 404);
    if ((int)$row['user_id'] !== (int)$p['id']) json(['error' => 'Accès refusé'], 403);

    $movId = (int)$row['mouvement_id'];
    $mouvementMontant = (float)$row['mouvement_montant'];

    // Somme des autres paiements
    $stmt = $pdo->prepare("SELECT COALESCE(SUM(montant),0) AS total FROM stock_paiements WHERE mouvement_id = ? AND id <> ?");
    $stmt->execute([$movId, $id]); $sum = $stmt->fetch();
    $totalAutres = (float)($sum ? $sum['total'] : 0);

    $newAmount = $hasAmount ? $amount : (float)$row['montant'];
    if (($totalAutres + $newAmount) - $mouvementMontant > 0.000001) {
      json(['error' => 'Le montant dépasse le reste à payer'], 400);
    }

    $newDate = $isoDate !== '' ? $isoDate : $row['date'];

    $stmt = $pdo->prepare("UPDATE stock_paiements SET `date` = ?, montant = ? WHERE id = ?");
    $stmt->execute([$newDate, $newAmount, $id]);

    json([
      'id' => $id,
      'mouvement_id' => $movId,
      'date' => $newDate,
      'montant' => $newAmount,
      'total_paye' => $totalAutres + $newAmount,
      'reste_a_payer' => max($mouvementMontant - ($totalAutres + $newAmount), 0)
    ]);
  }

  // DELETE /api/stockPaiements/:id
  if ($method === 'DELETE' && !empty($m[1])) {
    $id = intval($m[1]); if ($id <= 0) json(['error' => 'ID invalide'], 400);

    // Récupérer paiement + mouvement et vérifier appartenance
    $stmt = $pdo->prepare("SELECT sp.id, sp.mouvement_id, sp.montant, sm.montant AS mouvement_montant, sm.user_id
                             FROM stock_paiements sp
                             JOIN stock_mouvements sm ON sm.id = sp.mouvement_id
                            WHERE sp.id = ? LIMIT 1");
    $stmt->execute([$id]); $row = $stmt->fetch();
    if (!$row) json(['error' => 'Paiement introuvable'], 404);
    if ((int)$row['user_id'] !== (int)$p['id']) json(['error' => 'Accès refusé'], 403);

    // Supprimer
    $stmt = $pdo->prepare("DELETE FROM stock_paiements WHERE id = ?");
    $stmt->execute([$id]);

    // Recalcul du total payé
    $stmt = $pdo->prepare("SELECT COALESCE(SUM(montant),0) AS total FROM stock_paiements WHERE mouvement_id = ?");
    $stmt->execute([(int)$row['mouvement_id']]); $sum = $stmt->fetch();
    $totalPaye = (float)($sum ? $sum['total'] : 0);
    $reste = max(((float)$row['mouvement_montant']) - $totalPaye, 0);

    json(['success' => true, 'mouvement_id' => (int)$row['mouvement_id'], 'total_paye' => $totalPaye, 'reste_a_payer' => $reste]);
  }

  // Méthode non supportée sur cette ressource
  json(['error' => 'Méthode non supportée'], 405);
}

// Fallback
json(['error' => 'Not found'], 404);
