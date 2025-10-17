<?php
// Simple PHP API for Hostinger shared hosting (no Node)
// Provides minimal endpoints needed by the SPA.

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, PATCH, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

$config = require __DIR__ . '/config.php';

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
  [$h,$p,$s] = $parts; $sig = base64url_decode($s);
  $calc = hash_hmac('sha256', "$h.$p", $config['jwt_secret'], true);
  if (!hash_equals($sig, $calc)) return null;
  $payload = json_decode(base64url_decode($p), true);
  if (!$payload) return null;
  if (isset($payload['exp']) && time() >= $payload['exp']) return null;
  return $payload;
}

function get_token_payload() {
  $auth = isset($_SERVER['HTTP_AUTHORIZATION']) ? $_SERVER['HTTP_AUTHORIZATION'] : (isset($_SERVER['Authorization']) ? $_SERVER['Authorization'] : '');
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
  } catch (Throwable $e) {
    json(['ok' => false, 'error' => 'db', 'message' => $e->getMessage()], 500);
  }
}

// Routing
if ($path === '/api/version' && $method === 'GET') {
  json(['version' => $config['app_version']]);
}

if ($path === '/api/login' && $method === 'POST') {
  $body = json_decode(file_get_contents('php://input'), true);
  $identifier = isset($body['identifier']) ? trim($body['identifier']) : '';
  $password = isset($body['password']) ? $body['password'] : '';
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
  } catch (Throwable $e) {
    try { $pdo->rollBack(); } catch (Throwable $_) {}
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

if ($path === '/api/stockFlux' && $method === 'GET') {
  $p = get_token_payload(); if (!$p) json(['error'=>'Token manquant ou invalide'], 401);
  $date = isset($_GET['date']) ? $_GET['date'] : date('Y-m-d');
  $pdo = db();
  // Flux minimal: mouvements du jour + paiements du jour (exemple)
  $stmt = $pdo->prepare("SELECT 'mouvement' AS kind, id, DATE_FORMAT(date,'%Y-%m-%d') as date, type, designation_id, quantite, prix, client_id, stock, stockR FROM stock_mouvements WHERE user_id = ? AND DATE(date)=? ORDER BY id ASC");
  $stmt->execute([$p['id'], $date]); $mouvs = $stmt->fetchAll();
  $stmt = $pdo->prepare("SELECT 'paiement' AS kind, id, mouvement_id, DATE_FORMAT(date,'%Y-%m-%d') as date, montant FROM stock_paiements WHERE (user_id = ? OR user_id IS NULL) AND DATE(date)=? ORDER BY id ASC");
  $stmt->execute([$p['id'], $date]); $pays = $stmt->fetchAll();
  json(['flux' => array_merge($mouvs, $pays)]);
}

// Safe remote-summary for front badge (no Node replication here)
if ($uri === '/api/sync/remote-summary' && $method === 'GET') {
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
