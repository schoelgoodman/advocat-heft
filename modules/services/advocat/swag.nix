# Die öffentliche Seite. Redaktion und API antworten hier nicht; die Redaktion hat
# ihren eigenen Namen in advocat-redaktion/swag.nix.
{...}: {
  flake.modules.nixos.advocat-swag = {
    config,
    lib,
    ...
  }: let
    cfg = config.neo.services.advocat;
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
