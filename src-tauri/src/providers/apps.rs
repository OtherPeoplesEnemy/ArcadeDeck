use super::Game;
use crate::config::AppEntry;

/// Standalone applications as wheel entries. Launch + exit-watch reuse the
/// normal process path; art comes from custom images or the art fetcher.
pub fn scan(apps: &[AppEntry]) -> Vec<Game> {
    let mut games = Vec::new();
    for app in apps {
        let Some(exec) = app.executable.resolve() else {
            continue; // not configured for this platform
        };
        let slug = app.name.to_lowercase().replace(' ', "-");
        games.push(Game {
            id: format!("app-{slug}"),
            title: app.name.clone(),
            system: app.category.clone().unwrap_or_else(|| "Apps".into()),
            provider: "app".into(),
            exec: Some(exec),
            args: app.args.clone(),
            steam_app_id: None,
            art: None,
            hidden: false,
        });
    }
    games
}
