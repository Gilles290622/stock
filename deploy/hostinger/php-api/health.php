<?php
// Minimal health probe to help diagnose 500s
header('Content-Type: application/json; charset=utf-8');
$info = [
  'php_version' => PHP_VERSION,
  'sapi' => PHP_SAPI,
  'loaded_extensions' => get_loaded_extensions(),
  'time' => date('c'),
];
echo json_encode($info, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
