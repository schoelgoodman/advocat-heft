# Hermes-Skill für das Advocat-Heft.
{...}: {
  flake.modules.nixos.advocat-skills = {
    config,
    lib,
    ...
  }: let
    cfg = config.neo.services.advocat;
    domain = config.neo.services.swag.domain or null;
    appdata = "${config.neo.core.volumes.appdata}/advocat";
    redaktion = config.neo.services.advocat-redaktion;
  in {
    config.neo.services.advocat.skill.conf = lib.neo.mkServiceSkill {
      service = "advocat";
      inherit cfg domain;
      description = "Advocat Finanz site, Redaktion, content versions";
      tags = ["neo" "advocat" "website" "markdown"];
      title = "Neo · Advocat-Heft";
      body = ''
        ## When to Use
        The Advocat Finanz website, the Redaktion editor, content updates, restoring an old version, rebuilding the image.

        ## Architecture notes
        - One container: `advocat` (local image `advocat-heft:local`, port 4321). Code: https://github.com/schoelgoodman/advocat-heft
        - The image holds only the renderer and the editor. No Markdown is baked in
        - `${appdata}/content` is mounted at `/content`: Markdown (`briefe/`, `kapitel/`, `recht/`), `media/` and its own `.git`
        - `${appdata}/site` is mounted at `/site`: generated HTML. Filled on start when empty, rebuilt per page on change
        - The container runs as `neo.core.uid:gid`. Files under appdata must stay owned by that user
        - Public site: `${cfg.subdomain}.<domain>`. `/redaktion` and `/api/` return 404 there
        - Redaktion: separate Neo service `advocat-redaktion` at `${redaktion.subdomain}.<domain>`, behind tinyauth (currently ${if redaktion.enabled then "enabled" else "disabled"}). Same container, no units of its own, so it shows no processes in the UI. Stop and restart through `advocat`
        - Every save in the Redaktion becomes a commit in `content/.git` after about 20 seconds of quiet. Restore writes the old file back as a new commit `Wiederhergestellt: …`

        ## Procedures
        1. Health-check unit `docker-advocat`, then `docker logs advocat --tail 100`
        2. Code update: `git pull` in the clone, `docker build -t advocat-heft:local .`, `systemctl restart docker-advocat`
        3. Content history: `git -C ${appdata}/content log --oneline`
        4. Full re-render: stop the unit, empty `${appdata}/site`, start the unit
        5. First install of content: see DEPLOY.md in the repo, step 3

        ## Pitfalls
        - `advocat-heft:local` is built on this machine. Docker auto-update cannot pull it. A missing image means the unit fails to start
        - Do not add `${redaktion.subdomain}.<domain>` to the custom domains of either service. Neo forwards custom domains to the public site, where `/redaktion` is 404
        - Never delete `content/.git`. It is the only version history of the texts
        - Do not edit Markdown by hand while the Redaktion is open on the same file. The editor commits only its own paths, a hand edit stays uncommitted
        - Do not clear appdata without confirmation. That deletes every text and image of the site
        - A custom domain proxies to the public site only. The Redaktion is never reachable on it

        ## Verification
        - `docker-advocat` is active
        - `GET https://${cfg.subdomain}.<domain>/` returns 200 without login
        - `GET https://${cfg.subdomain}.<domain>/redaktion` returns 404
        - `https://${redaktion.subdomain}.<domain>` redirects to tinyauth, then shows the editor
      '';
    };
  };
}
