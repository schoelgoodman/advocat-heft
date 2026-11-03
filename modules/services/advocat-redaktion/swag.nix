# Redaktion: alles hinter tinyauth. Die Wurzel ist die Redaktion.
{...}: {
  flake.modules.nixos.advocat-redaktion-swag = {
    config,
    lib,
    ...
  }: let
    cfg = config.neo.services.advocat-redaktion;
    # Wer die Redaktion in einem Rahmen zeigen darf: sie selbst und die Neo-Oberfläche (neo.<domain>
    # bettet Dienste ein). Neo entfernt dafür CSP und X-Frame-Options der Container (proxy.conf,
    # iframeCookieSupport); nginx setzt die CSP darum selbst. Sonst könnte jede fremde Seite die
    # Redaktion unsichtbar einbetten und Klicks auf «Veröffentlichen» oder «Löschen» erschleichen.
    domain = config.neo.services.swag.domain or null;
    neoHost = "${config.neo.services.neo.subdomain or "neo"}.${domain}";
    rahmen = "frame-ancestors 'self'" + lib.optionalString (domain != null) " https://${neoHost}";
    # Skript nur aus /assets und /site.js. Stil auch inline: Milkdown setzt style-Tags und -Attribute.
    # Bilder auch von https: Im Editor lässt sich eine Bildadresse einfügen. Die Karte in der Vorschau
    # von Kontakt kommt von Google.
    csp = lib.concatStringsSep "; " [
      "default-src 'self'"
      "script-src 'self'"
      "style-src 'self' 'unsafe-inline'"
      "img-src 'self' data: blob: https:"
      "font-src 'self' data:"
      "connect-src 'self'"
      "frame-src 'self' https://www.google.com"
      "object-src 'none'"
      "base-uri 'self'"
      "form-action 'self'"
      rahmen
    ];
    # Direkt geöffnet darf ein SVG kein Skript ausführen. Die App setzt das auch, aber Neo entfernt es.
    svgCsp = "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'; ${rahmen}";
    # Der Schlüssel liegt in einer gerenderten Datei neben den proxy-confs, nicht im Nix-Store.
    mitSchluessel = cfg.schluessel != "";
    schluessel = lib.neo.secrets.swagSnippet config "advocat-redaktion-schluessel" ''
      proxy_set_header X-Redaktion-Schluessel "${cfg.schluessel}";
    '';
  in {
    config.neo.core.secrets.templates = lib.mkIf (cfg.enabled && mitSchluessel) schluessel.templates;

    config.neo.services.advocat-redaktion.proxyConf = lib.mkDefault ''
      map $uri $advocat_redaktion_csp {
        default "${csp}";
        "~*\.svg$" "${svgCsp}";
      }

      server {
        include /config/nginx/listen-https.conf;
        http2 on;
        server_name ${cfg.subdomain}.*;
        include /config/nginx/ssl.conf;
        include /config/nginx/geo-access.conf;
        client_max_body_size 32m;
        # Auf Server-Ebene: so ergänzt er die add_header aus ssl.conf (etwa HSTS), statt sie zu verdrängen.
        add_header Content-Security-Policy $advocat_redaktion_csp always;

        location / {
          ${lib.optionalString (!(cfg.auth.enabled && config.neo.services.tinyauth.enabled)) "return 403;"}
          include /config/nginx/proxy.conf;
          include /config/nginx/resolver.conf;
          # Nach proxy.conf, in derselben location: Ein Browser kann den Header nicht vorgeben, nginx überschreibt ihn.
          # Ohne Schlüssel antwortet die Redaktion 503.
          ${lib.optionalString mitSchluessel schluessel.include}
          set $upstream_app advocat-redaktion;
          set $upstream_port 4321;
          set $upstream_proto http;
          proxy_pass $upstream_proto://$upstream_app:$upstream_port;
          ${lib.neo.authBlock config cfg}
        }
        ${lib.neo.authLocations config cfg}
      }
    '';
  };
}
