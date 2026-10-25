# Startet den Node-Prozess. Inhalt und HTML liegen auf dem Volume.
{...}: {
  flake.modules.nixos.advocat = {
    config,
    lib,
    ...
  }:
    with lib; let
      cfg = config.neo.services.advocat;
      appdata = "${config.neo.core.volumes.appdata}/advocat";
    in {
      config = mkIf cfg.enabled {
        systemd.services.docker-advocat.preStart = lib.concatStringsSep "\n" [
          (lib.neo.mkActivationScriptForDir config {dirPath = "${appdata}/content";})
          (lib.neo.mkActivationScriptForDir config {dirPath = "${appdata}/site";})
        ];

        virtualisation.oci-containers.containers.advocat = {
          environment = {
            TZ = "Europe/Zurich";
            NODE_ENV = "production";
            CONTENT_DIR = "/content";
            SITE_DIR = "/site";
            PORT = "4321";
          };
          image = cfg.containers.advocat;
          autoStart = true;
          volumes = [
            "${appdata}/content:/content"
            "${appdata}/site:/site"
          ];
          networks = ["internal"];
        };
      };
    };
}
