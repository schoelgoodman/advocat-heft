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
        systemd.services.docker-advocat.preStart = lib.neo.mkEnsureDirs config [
          appdata
          "${appdata}/content"
          "${appdata}/site"
        ];

        virtualisation.oci-containers.containers.advocat = {
          environment = {
            TZ = config.neo.core.timeZone;
            NODE_ENV = "production";
            CONTENT_DIR = "/content";
            SITE_DIR = "/site";
            PORT = "4321";
          };
          image = cfg.containers.advocat;
          # Gleiche Besitzer wie die Ordner aus preStart, sonst gehören neue Dateien root.
          user = "${toString config.neo.core.uid}:${toString config.neo.core.gid}";
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
