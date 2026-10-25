# Zwei Namen, ein Upstream. Die Seite ist öffentlich, die Redaktion nur mit tinyauth.
{...}: {
  flake.modules.nixos.advocat-swag = {
    config,
    lib,
    ...
  }: let
    cfg = config.neo.services.advocat;
    tinyauthOn = cfg.auth.enabled && ((config.neo.services.tinyauth or {}).enabled or false);
    upstream = ''
      include /config/nginx/proxy.conf;
      include /config/nginx/resolver.conf;
      set $upstream_app advocat;
      set $upstream_port 4321;
      set $upstream_proto http;
      proxy_pass $upstream_proto://$upstream_app:$upstream_port;
    '';
  in {
    config.neo.services.advocat.proxyConf = lib.mkDefault ''
      server {
        include /config/nginx/listen-https.conf;
        http2 on;
        server_name ${cfg.subdomain}.*;
        include /config/nginx/ssl.conf;
        include /config/nginx/geo-access.conf;
        client_max_body_size 1m;

        location /redaktion { return 404; }
        location /api/ { return 404; }

        location / {
          ${upstream}
        }
      }

      server {
        include /config/nginx/listen-https.conf;
        http2 on;
        server_name redaktion.*;
        include /config/nginx/ssl.conf;
        include /config/nginx/geo-access.conf;
        client_max_body_size 32m;

        location / {
          ${lib.optionalString (!tinyauthOn) "return 403;"}
          ${upstream}
          ${lib.neo.authBlock config cfg}
        }
        ${lib.neo.authLocations config cfg}
      }
    '';
  };
}
