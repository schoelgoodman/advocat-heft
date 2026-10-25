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
              # Die Seite ist öffentlich. Die Anmeldung gehört zu advocat-redaktion.
              auth.available = false;
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
              icon = ./icon.png;
              description = ''
                Das Heft von Advocat Finanz. Die öffentliche Seite steht unter dem
                Subdomain-Namen. Die Redaktion ist der Dienst Advocat Redaktion, hinter
                tinyauth. Markdown und Bilder liegen auf dem Appdata-Volume, nicht im Image.
              '';
              projectUrl = "https://advocat-finanz.ch/";
              githubUrl = "https://github.com/schoelgoodman/advocat-heft";
            }
            // lib.neo.mkSkillOptions {};
        };
        default = {};
        description = "Advocat Finanz: Heft, Redaktion und Fassungen";
      };
    };
}
