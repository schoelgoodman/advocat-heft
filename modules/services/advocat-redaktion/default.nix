# Die Redaktion hat keinen eigenen Container. Hier steht nur die Abhängigkeit.
{...}: {
  flake.modules.nixos.advocat-redaktion = {
    config,
    lib,
    ...
  }:
    with lib; let
      cfg = config.neo.services.advocat-redaktion;
    in {
      config = mkIf cfg.enabled {
        assertions = [
          {
            assertion = config.neo.services.advocat.enabled;
            message = "neo.services.advocat-redaktion braucht neo.services.advocat. Den Dienst Advocat Finanz einschalten.";
          }
        ];
      };
    };
}
