# Advocat-Heft: öffentliche Seite und Redaktion, ein Container.
{...}: {
  flake.modules.nixos.advocat-option = {
    config,
    lib,
    ...
  }:
    with lib;
    with {inherit (lib.neo) mkOption mkEnableOption;}; {
      options.neo.services.advocat = mkOption {
        type = types.submodule {
          options =
            {
              enabled = mkEnableOption "Advocat Finanz" {rank = 0;};
            }
            // neo.mkReverseProxyOptions {
              subdomain = "advocat";
              auth.enabled = true;
            }
            // neo.mkVpnOptions {
              containers = ["advocat"];
              networks = ["internal"];
              ports = [4321];
            }
            // lib.neo.mkContainerDefinitions {
              # Auf dem Homeserver bauen: docker build -t advocat-heft:local .
              # Das Image enthält nur den Setzer, kein Markdown.
              advocat = "advocat-heft:local";
            }
            // lib.neo.mkAppdata "${config.neo.core.volumes.appdata}/advocat"
            // lib.neo.mkServiceMeta {
              category = "Other";
              description = ''
                Das Heft von Advocat Finanz. Die öffentliche Seite steht unter dem
                Subdomain-Namen. Die Redaktion steht unter redaktion.<domain>, hinter
                tinyauth. Markdown und Bilder liegen auf dem Appdata-Volume, nicht im Image.
              '';
              projectUrl = "https://advocat-finanz.ch/";
            };
        };
        default = {};
        description = "Advocat Finanz: Heft, Redaktion und Fassungen";
      };
    };
}
