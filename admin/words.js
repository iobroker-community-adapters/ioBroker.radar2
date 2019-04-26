/*global systemDictionary:true */
'use strict';

systemDictionary = {
    "Long Warning Message:": {
        "en": "Use long message text with description for warnings: ",
        "de": "Benutze langen Warnungstext mit genauer Beschreibung: "
    },
    "hcionly": {
        "en": "use hcitool instead of noble on linux",
        "de": "Betutze 'hcitool' anstatt 'noble' auf linux"
    },
    "radar2 settings": {
        "en": "radar2 settings",
        "de": "radar2-Einstellungen"
    },
    "Device setup": {
        "en": "individual device setup",
        "de": "Individuelle Suchobjekt-Einstellungen"
    },
    "UWZ Delay:": {
        "en": "Delay in minutes between UWZ scans 0=no UWZ scan: ",
        "de": "Verzögerung in Minuten zwischen UWZ-Abfragen 0=UWZ ausgeschaltet: "
    },
    "Max UWZ vars:": {
        "en": "How many seperate messages  0=all messages together: ",
        "de": "Maximum Meldungen in UWZ 0=alle Meldungen zusammen: "
    },
    "Scan Delay:": {
        "en": "Delay in seconds between scans (>=15): ",
        "de": "Verzögerung in Sekunden zwischen Abfragen (>=15): "
    },
    "arp-scan cmdline:": {
        "en": "Arp-Scan command line, need to be changed if default interface is not first",
        "de": "arp-scan Kommandozeile, muss aber geändert werden falls das 1. Netwerkinterface nicht default ist."
    },
    "Delay Away:": {
        "en": "How long (in minutes) should be a device not detected before it's marked as away' (>=2): ",
        "de": "Abwesenheit in Minuten um als 'nicht da' zu gelten (>=2): "
    },
    "Printer Delay:": {
        "en": "Delay in minutes between printer fill check (>=100): ",
        "de": "Verzögerung in Minuten zwischen Druckerfüllstand-Abfrage (>=100): "
    },
    "External Network Scan Delay:": {
        "en": "Delay in minutes between External Network IP scan (0 = no scan): ",
        "de": "Verzögerung in Minuten zwischen den externen Netwerkabfragen (wenn 0 dann ausgeschaltet): "
    },
    "description": {
        "de": "IP-Adressen können als Name oder Zahlen angegeben werden. Bluetooth ist immer '01:23:45:67:89:ab', MAC-Adressen wie bei Bluetooth aber es können mehrere mit ',' getrennt angegeben werden. Eine der drei (IP, MAC oder BT) muß mindestens angegeben werden. MAC scan steht nur zur Verfügung wenn 'arp-scan' installiert ist",
        "en": "IP can be name or number (like fritz.box or 168.192.0.1). Bluetooth is always '01:23:45:67:89:ab', either or both of them have to be there."
    },
    "BT adapter id:": {
        "de": "bei Linux: nummer des Bluetooth-Adapters (0 = hci0):",
        "en": "on Linux: number of Bluetooth adapter (0 = hci0):"
    },
    "known IP addresses:": {
        "de": "IP-Adressen die bekannt sind und keine 'unknown'-Einträge generieren sollen, mit ',' separiert:",
        "en": "IP-addresses which are known and should not generate 'unknown' entries separated by ',':"
    },
    "known BT addresses:": {
        "de": "BT-Adressen die bekannt sind und keine 'unknown'-Einträge generieren sollen, mit ',' separiert:",
        "en": "BT-addresses which are known and should not generate 'unknown' entries separated by ',':"
    },
    "dont forget to save config!": {
        "de": "Bitte Konfiguration speichern!",
        "en": "Don't forget to save the config before restart of adapter!"
    },
    "Object configutaion list below:": {
        "de": "Liste der konfigurierten Objekte:",
        "en": "Object configutaion list below:"
    },
    "Remove hostname ending:": {
        "de": "Hostname werden dieses Ende gelöscht bekommen, ein '!' am Ende schaltet Debug ein!",
        "en": "hostnames will get this ending removed, an '!' at the very end switches on debug mode!"
    }

};
