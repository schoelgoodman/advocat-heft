# Die öffentliche Seite. Redaktion und API antworten hier nicht; die Redaktion hat
# ihren eigenen Namen in advocat-redaktion/swag.nix.
{...}: {
  flake.modules.nixos.advocat-swag = {
    config,
    lib,
    ...
  }: let
    cfg = config.neo.services.advocat;
    # Neo entfernt die CSP der Container (iframeCookieSupport), darum setzt nginx sie.
    # Die Neo-Oberfläche darf die Seite einbetten, fremde Seiten nicht.
    domain = config.neo.services.swag.domain or null;
    neoHost = "${config.neo.services.neo.subdomain or "neo"}.${domain}";
    rahmen = "frame-ancestors 'self'" + lib.optionalString (domain != null) " https://${neoHost}";
    # Skript nur /site.js (JSON-LD und der Suchindex sind Daten, die CSP lässt sie). Kein Inline-Stil
    # im gesetzten HTML. Die Karte bei Kontakt lädt auf Klick von Google.
    csp = lib.concatStringsSep "; " [
      "default-src 'self'"
      "script-src 'self'"
      "style-src 'self'"
      "img-src 'self' data: https:"
      "font-src 'self'"
      "connect-src 'self'"
      "frame-src https://www.google.com"
      "object-src 'none'"
      "base-uri 'self'"
      "form-action 'self'"
      rahmen
    ];
    svgCsp = "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'; ${rahmen}";
  in {
    config.neo.services.advocat.proxyConf = lib.mkDefault ''
      map $uri $advocat_csp {
        default "${csp}";
        "~*\.svg$" "${svgCsp}";
      }

      server {
        include /config/nginx/listen-https.conf;
        http2 on;
        server_name ${cfg.subdomain}.*;
        include /config/nginx/ssl.conf;
        include /config/nginx/geo-access.conf;
        client_max_body_size 1m;
        # Auf Server-Ebene, wie bei der Redaktion: ergänzt die add_header aus ssl.conf.
        add_header Content-Security-Policy $advocat_csp always;

        location /redaktion { return 404; }
        location /api/ { return 404; }

        location / {
          include /config/nginx/proxy.conf;
          include /config/nginx/resolver.conf;
          set $upstream_app advocat;
          set $upstream_port 4321;
          set $upstream_proto http;
          proxy_pass $upstream_proto://$upstream_app:$upstream_port;
        }
      }
    '';
  };
}
