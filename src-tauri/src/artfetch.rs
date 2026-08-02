use crate::providers::{sanitize_id, Game};
use serde::Serialize;
use std::fs;
use std::path::Path;
use std::time::Duration;

#[derive(Serialize)]
pub struct FetchResult {
    pub fetched: usize,
    pub failed: usize,
}

/// Download art for every visible game that has none.
///
/// Strategy per game:
/// - Steam games: Steam's own CDN first (no key needed), SteamGridDB by
///   app id as fallback.
/// - Everything else: SteamGridDB name search (needs the free API key).
///
/// Files land in `config_dir/art-cache/`; user custom art in `art/` still
/// wins over anything downloaded.
pub fn fetch_missing(api_key: Option<&str>) -> Result<FetchResult, String> {
    let cfg = crate::config::load();
    let games = crate::providers::scan_all(&cfg);
    let dir = crate::config::config_dir().join("art-cache");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let client = reqwest::blocking::Client::builder()
        .user_agent("ArcadeDeck")
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;

    let key = api_key.filter(|k| !k.trim().is_empty());

    let mut fetched = 0usize;
    let mut failed = 0usize;
    for g in games.iter().filter(|g| g.art.is_none() && !g.hidden) {
        if fetch_one(&client, g, key, &dir) {
            fetched += 1;
        } else {
            failed += 1;
        }
    }
    Ok(FetchResult { fetched, failed })
}

fn fetch_one(
    client: &reqwest::blocking::Client,
    game: &Game,
    key: Option<&str>,
    dir: &Path,
) -> bool {
    if game.provider == "steam" {
        let Some(appid) = &game.steam_app_id else {
            return false;
        };
        // Steam CDN: predictable URL, no auth.
        let cdn = format!(
            "https://cdn.cloudflare.steamstatic.com/steam/apps/{appid}/library_600x900.jpg"
        );
        if download(client, &cdn, dir, &game.id) {
            return true;
        }
        // Older/delisted titles: try SteamGridDB by app id.
        if let Some(k) = key {
            if let Some(url) = sgdb_grid_url(client, k, &format!("grids/steam/{appid}")) {
                return download(client, &url, dir, &game.id);
            }
        }
        return false;
    }

    // Non-Steam: name search on SteamGridDB.
    let Some(k) = key else {
        return false;
    };
    let Some(game_id) = sgdb_search(client, k, &game.title) else {
        return false;
    };
    match sgdb_grid_url(client, k, &format!("grids/game/{game_id}")) {
        Some(url) => download(client, &url, dir, &game.id),
        None => false,
    }
}

/// First 600x900 grid for an SGDB endpoint fragment, if any.
fn sgdb_grid_url(
    client: &reqwest::blocking::Client,
    key: &str,
    endpoint: &str,
) -> Option<String> {
    let url = format!(
        "https://www.steamgriddb.com/api/v2/{endpoint}?dimensions=600x900"
    );
    let resp = client.get(&url).bearer_auth(key).send().ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let json: serde_json::Value = resp.json().ok()?;
    json["data"]
        .as_array()?
        .first()?
        .get("url")?
        .as_str()
        .map(|s| s.to_string())
}

/// SGDB game id for a title, via autocomplete search.
fn sgdb_search(client: &reqwest::blocking::Client, key: &str, title: &str) -> Option<i64> {
    let encoded: String = title
        .bytes()
        .map(|b| {
            if b.is_ascii_alphanumeric() {
                (b as char).to_string()
            } else {
                format!("%{b:02X}")
            }
        })
        .collect();
    let url = format!("https://www.steamgriddb.com/api/v2/search/autocomplete/{encoded}");
    let resp = client.get(&url).bearer_auth(key).send().ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let json: serde_json::Value = resp.json().ok()?;
    json["data"].as_array()?.first()?.get("id")?.as_i64()
}

fn download(
    client: &reqwest::blocking::Client,
    url: &str,
    dir: &Path,
    game_id: &str,
) -> bool {
    let Ok(resp) = client.get(url).send() else {
        return false;
    };
    if !resp.status().is_success() {
        return false;
    }
    let ext = if url.to_lowercase().contains(".png") {
        "png"
    } else {
        "jpg"
    };
    let Ok(bytes) = resp.bytes() else {
        return false;
    };
    if bytes.len() < 1000 {
        return false; // error page, not an image
    }
    let path = dir.join(format!("{}.{ext}", sanitize_id(game_id)));
    fs::write(path, &bytes).is_ok()
}
