# Redaktion: alles hinter tinyauth. Die Wurzel ist die Redaktion.
{...}: {
  flake.modules.nixos.advocat-redaktion-swag = {
    config,
    lib,
    ...
  }: let
    cfg = config.neo.services.advocat-redaktion;
  in {
    config.neo.services.advocat-redaktion.proxyConf = lib.mkDefault ''
      server {
        include /config/nginx/listen-https.conf;
        http2 on;
        server_name ${cfg.subdomain}.*;
        include /config/nginx/ssl.conf;
        include /config/nginx/geo-access.conf;
        client_max_body_size 32m;

        location / {
          ${lib.optionalString (!(cfg.auth.enabled && config.neo.services.tinyauth.enabled)) "return 403;"}
          include /config/nginx/proxy.conf;
          include /config/nginx/resolver.conf;
          set $upstream_app advocat;
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
