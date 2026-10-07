(function initializeI18n(globalScope) {
  "use strict";

  const DEFAULT_LANGUAGE = "en";
  const SUPPORTED_LANGUAGES = ["en", "pt-BR", "es", "fr", "de"];
  const LANGUAGE_NAMES = {
    en: "English",
    "pt-BR": "Português (Brasil)",
    es: "Español",
    fr: "Français",
    de: "Deutsch",
  };

  const translations = {
    "pt-BR": {
      "New file": "Novo arquivo", Import: "Importar", "New folder": "Nova pasta", Manage: "Gerenciar", "Import link": "Importar link",
      "Search files and folders": "Pesquisar arquivos e pastas", Pinned: "Fixados", Folders: "Pastas", Unfiled: "Sem pasta",
      "No files in this folder.": "Nenhum arquivo nesta pasta.", "No matching files or folders.": "Nenhum arquivo ou pasta encontrado.",
      Settings: "Configurações", "Simple, local-first controls": "Controles simples, com armazenamento local primeiro", General: "Geral",
      "Appearance and launcher": "Aparência e atalho", Language: "Idioma", Theme: "Tema", System: "Sistema", Light: "Claro", Dark: "Escuro",
      "Floating launcher": "Atalho flutuante", "Show ExcaliSync on the canvas": "Mostrar o ExcaliSync na tela", Saving: "Salvamento",
      "Local copies are always written first": "As cópias locais são sempre salvas primeiro", "Local first": "Local primeiro",
      Autosave: "Salvamento automático", "After every edit": "Após cada edição", "On a timer": "Por intervalo", Manual: "Manual",
      Interval: "Intervalo", "Warn if pending": "Avisar se estiver pendente", Notifications: "Notificações", "Show save and sync alerts": "Mostrar alertas de salvamento e sincronização",
      "Local save": "Salvamento local", "Cloud sync": "Sincronização na nuvem", "Not connected": "Não conectado", "Local storage": "Armazenamento local",
      "Disk copy plus browser recovery copy": "Cópia no disco e cópia de recuperação do navegador", Connected: "Conectado", "Helper needed": "Auxiliar necessário",
      "Open vault": "Abrir pasta", "Delete files": "Excluir arquivos", "Expand a provider to configure it": "Expanda um provedor para configurá-lo",
      Repository: "Repositório", Visibility: "Visibilidade", Private: "Privado", Public: "Público", "Root folder": "Pasta raiz", Folder: "Pasta",
      "Link sharing": "Compartilhamento por link", Connect: "Conectar", Reconnect: "Reconectar", Disconnect: "Desconectar", "Save changes": "Salvar alterações",
      Clear: "Limpar", "No alerts. Your drawings are up to date.": "Nenhum alerta. Seus desenhos estão atualizados.",
      "Automatic sync on": "Sincronização automática ativada", "Automatic sync off": "Sincronização automática desativada", "Auto on": "Auto ativa", "Auto off": "Auto inativa",
      "Waiting for first sync": "Aguardando a primeira sincronização", "Needs attention": "Requer atenção", "Sync all documents now": "Sincronizar todos os documentos agora",
      "Close sidebar": "Fechar barra lateral", "Back to files": "Voltar aos arquivos", "Create a GitHub OAuth App": "Criar um aplicativo OAuth do GitHub",
      "Create a Google OAuth client": "Criar um cliente OAuth do Google", "Open GitHub": "Abrir GitHub", "Enter this code on GitHub": "Digite este código no GitHub",
      "Download": "Baixar", "Refresh": "Atualizar", "ExcaliSync local vault": "Pasta local do ExcaliSync", "Your browser-local copy of every Excalidraw document.": "Sua cópia local de cada documento do Excalidraw.",
    },
    es: {
      "New file": "Nuevo archivo", Import: "Importar", "New folder": "Nueva carpeta", Manage: "Administrar", "Import link": "Importar enlace",
      "Search files and folders": "Buscar archivos y carpetas", Pinned: "Fijados", Folders: "Carpetas", Unfiled: "Sin carpeta",
      "No files in this folder.": "No hay archivos en esta carpeta.", "No matching files or folders.": "No se encontraron archivos ni carpetas.",
      Settings: "Configuración", "Simple, local-first controls": "Controles simples con prioridad local", General: "General", "Appearance and launcher": "Apariencia y acceso",
      Language: "Idioma", Theme: "Tema", System: "Sistema", Light: "Claro", Dark: "Oscuro", "Floating launcher": "Acceso flotante", "Show ExcaliSync on the canvas": "Mostrar ExcaliSync en el lienzo",
      Saving: "Guardado", "Local copies are always written first": "Las copias locales siempre se guardan primero", "Local first": "Local primero", Autosave: "Guardado automático",
      "After every edit": "Después de cada edición", "On a timer": "Por intervalo", Manual: "Manual", Interval: "Intervalo", "Warn if pending": "Avisar si está pendiente",
      Notifications: "Notificaciones", "Show save and sync alerts": "Mostrar alertas de guardado y sincronización", "Local save": "Guardado local", "Cloud sync": "Sincronización en la nube",
      "Not connected": "No conectado", "Local storage": "Almacenamiento local", "Disk copy plus browser recovery copy": "Copia en disco y copia de recuperación del navegador",
      Connected: "Conectado", "Helper needed": "Se necesita el auxiliar", "Open vault": "Abrir carpeta", "Delete files": "Eliminar archivos",
      "Expand a provider to configure it": "Expande un proveedor para configurarlo", Repository: "Repositorio", Visibility: "Visibilidad", Private: "Privado", Public: "Público",
      "Root folder": "Carpeta raíz", Folder: "Carpeta", "Link sharing": "Compartir por enlace", Connect: "Conectar", Reconnect: "Reconectar", Disconnect: "Desconectar",
      "Save changes": "Guardar cambios", Clear: "Limpiar", "No alerts. Your drawings are up to date.": "No hay alertas. Tus dibujos están actualizados.",
      "Automatic sync on": "Sincronización automática activada", "Automatic sync off": "Sincronización automática desactivada", "Auto on": "Auto activa", "Auto off": "Auto inactiva",
      "Waiting for first sync": "Esperando la primera sincronización", "Needs attention": "Requiere atención", "Sync all documents now": "Sincronizar todos los documentos ahora",
      "Close sidebar": "Cerrar barra lateral", "Back to files": "Volver a los archivos", "Create a GitHub OAuth App": "Crear una aplicación OAuth de GitHub",
      "Create a Google OAuth client": "Crear un cliente OAuth de Google", "Open GitHub": "Abrir GitHub", "Enter this code on GitHub": "Introduce este código en GitHub",
      Download: "Descargar", Refresh: "Actualizar", "ExcaliSync local vault": "Carpeta local de ExcaliSync", "Your browser-local copy of every Excalidraw document.": "Tu copia local de cada documento de Excalidraw.",
    },
    fr: {
      "New file": "Nouveau fichier", Import: "Importer", "New folder": "Nouveau dossier", Manage: "Gérer", "Import link": "Importer un lien",
      "Search files and folders": "Rechercher des fichiers et dossiers", Pinned: "Épinglés", Folders: "Dossiers", Unfiled: "Non classés",
      "No files in this folder.": "Aucun fichier dans ce dossier.", "No matching files or folders.": "Aucun fichier ou dossier correspondant.",
      Settings: "Paramètres", "Simple, local-first controls": "Contrôles simples, stockage local prioritaire", General: "Général", "Appearance and launcher": "Apparence et lanceur",
      Language: "Langue", Theme: "Thème", System: "Système", Light: "Clair", Dark: "Sombre", "Floating launcher": "Lanceur flottant", "Show ExcaliSync on the canvas": "Afficher ExcaliSync sur le canevas",
      Saving: "Enregistrement", "Local copies are always written first": "Les copies locales sont toujours enregistrées en premier", "Local first": "Local d'abord", Autosave: "Enregistrement automatique",
      "After every edit": "Après chaque modification", "On a timer": "Selon un intervalle", Manual: "Manuel", Interval: "Intervalle", "Warn if pending": "Avertir si en attente",
      Notifications: "Notifications", "Show save and sync alerts": "Afficher les alertes d'enregistrement et de synchronisation", "Local save": "Enregistrement local", "Cloud sync": "Synchronisation cloud",
      "Not connected": "Non connecté", "Local storage": "Stockage local", "Disk copy plus browser recovery copy": "Copie disque et copie de récupération du navigateur",
      Connected: "Connecté", "Helper needed": "Assistant requis", "Open vault": "Ouvrir le dossier", "Delete files": "Supprimer les fichiers",
      "Expand a provider to configure it": "Développez un fournisseur pour le configurer", Repository: "Dépôt", Visibility: "Visibilité", Private: "Privé", Public: "Public",
      "Root folder": "Dossier racine", Folder: "Dossier", "Link sharing": "Partage par lien", Connect: "Connecter", Reconnect: "Reconnecter", Disconnect: "Déconnecter",
      "Save changes": "Enregistrer", Clear: "Effacer", "No alerts. Your drawings are up to date.": "Aucune alerte. Vos dessins sont à jour.",
      "Automatic sync on": "Synchronisation automatique activée", "Automatic sync off": "Synchronisation automatique désactivée", "Auto on": "Auto active", "Auto off": "Auto inactive",
      "Waiting for first sync": "En attente de la première synchronisation", "Needs attention": "Attention requise", "Sync all documents now": "Synchroniser tous les documents",
      "Close sidebar": "Fermer la barre latérale", "Back to files": "Retour aux fichiers", "Create a GitHub OAuth App": "Créer une application OAuth GitHub",
      "Create a Google OAuth client": "Créer un client OAuth Google", "Open GitHub": "Ouvrir GitHub", "Enter this code on GitHub": "Saisissez ce code sur GitHub",
      Download: "Télécharger", Refresh: "Actualiser", "ExcaliSync local vault": "Dossier local ExcaliSync", "Your browser-local copy of every Excalidraw document.": "Votre copie locale de chaque document Excalidraw.",
    },
    de: {
      "New file": "Neue Datei", Import: "Importieren", "New folder": "Neuer Ordner", Manage: "Verwalten", "Import link": "Link importieren",
      "Search files and folders": "Dateien und Ordner suchen", Pinned: "Angeheftet", Folders: "Ordner", Unfiled: "Nicht zugeordnet",
      "No files in this folder.": "Keine Dateien in diesem Ordner.", "No matching files or folders.": "Keine passenden Dateien oder Ordner.",
      Settings: "Einstellungen", "Simple, local-first controls": "Einfache Steuerung mit lokalem Speicher zuerst", General: "Allgemein", "Appearance and launcher": "Darstellung und Starter",
      Language: "Sprache", Theme: "Design", System: "System", Light: "Hell", Dark: "Dunkel", "Floating launcher": "Schwebender Starter", "Show ExcaliSync on the canvas": "ExcaliSync auf der Zeichenfläche anzeigen",
      Saving: "Speichern", "Local copies are always written first": "Lokale Kopien werden immer zuerst gespeichert", "Local first": "Lokal zuerst", Autosave: "Automatisch speichern",
      "After every edit": "Nach jeder Änderung", "On a timer": "Nach Zeitintervall", Manual: "Manuell", Interval: "Intervall", "Warn if pending": "Bei ausstehender Speicherung warnen",
      Notifications: "Benachrichtigungen", "Show save and sync alerts": "Speicher- und Synchronisierungswarnungen anzeigen", "Local save": "Lokal gespeichert", "Cloud sync": "Cloud-Synchronisierung",
      "Not connected": "Nicht verbunden", "Local storage": "Lokaler Speicher", "Disk copy plus browser recovery copy": "Festplattenkopie plus Browser-Wiederherstellung",
      Connected: "Verbunden", "Helper needed": "Hilfsprogramm erforderlich", "Open vault": "Ordner öffnen", "Delete files": "Dateien löschen",
      "Expand a provider to configure it": "Anbieter zum Konfigurieren öffnen", Repository: "Repository", Visibility: "Sichtbarkeit", Private: "Privat", Public: "Öffentlich",
      "Root folder": "Stammordner", Folder: "Ordner", "Link sharing": "Linkfreigabe", Connect: "Verbinden", Reconnect: "Neu verbinden", Disconnect: "Trennen",
      "Save changes": "Änderungen speichern", Clear: "Leeren", "No alerts. Your drawings are up to date.": "Keine Warnungen. Deine Zeichnungen sind aktuell.",
      "Automatic sync on": "Automatische Synchronisierung aktiv", "Automatic sync off": "Automatische Synchronisierung inaktiv", "Auto on": "Auto an", "Auto off": "Auto aus",
      "Waiting for first sync": "Warten auf erste Synchronisierung", "Needs attention": "Aktion erforderlich", "Sync all documents now": "Alle Dokumente jetzt synchronisieren",
      "Close sidebar": "Seitenleiste schließen", "Back to files": "Zurück zu den Dateien", "Create a GitHub OAuth App": "GitHub-OAuth-App erstellen",
      "Create a Google OAuth client": "Google-OAuth-Client erstellen", "Open GitHub": "GitHub öffnen", "Enter this code on GitHub": "Diesen Code auf GitHub eingeben",
      Download: "Herunterladen", Refresh: "Aktualisieren", "ExcaliSync local vault": "Lokaler ExcaliSync-Ordner", "Your browser-local copy of every Excalidraw document.": "Deine lokale Kopie jedes Excalidraw-Dokuments.",
    },
  };

  function normalizeLanguage(value) {
    const language = String(value || "").replace(/_/g, "-").toLowerCase();
    if (language.startsWith("pt")) return "pt-BR";
    if (language.startsWith("es")) return "es";
    if (language.startsWith("fr")) return "fr";
    if (language.startsWith("de")) return "de";
    return "en";
  }

  function translate(text, language = DEFAULT_LANGUAGE) {
    return translations[normalizeLanguage(language)]?.[text] || text;
  }

  function formatRelativeTime(dateValue, language = DEFAULT_LANGUAGE, now = Date.now()) {
    if (!dateValue) return translate("Never", language);
    const seconds = Math.max(0, Math.floor((now - new Date(dateValue).getTime()) / 1000));
    const formatter = new Intl.RelativeTimeFormat(normalizeLanguage(language), { numeric: "auto" });
    if (seconds < 60) return formatter.format(-seconds, "second");
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return formatter.format(-minutes, "minute");
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return formatter.format(-hours, "hour");
    return new Intl.DateTimeFormat(normalizeLanguage(language), { dateStyle: "medium", timeStyle: "short" }).format(new Date(dateValue));
  }

  function localizeTree(root, language = DEFAULT_LANGUAGE) {
    if (!root || normalizeLanguage(language) === "en") return;
    const documentRef = root.ownerDocument || globalScope.document;
    const walker = documentRef.createTreeWalker(root, 4);
    let node = walker.nextNode();
    while (node) {
      if (!node.parentElement?.closest("[data-i18n-skip], code, .vault-path")) {
        const match = node.nodeValue.match(/^(\s*)(.*?)(\s*)$/s);
        if (match?.[2]) node.nodeValue = `${match[1]}${translate(match[2], language)}${match[3]}`;
      }
      node = walker.nextNode();
    }
    for (const element of root.querySelectorAll("[aria-label], [title], [placeholder]")) {
      for (const attribute of ["aria-label", "title", "placeholder"]) {
        if (element.hasAttribute(attribute)) element.setAttribute(attribute, translate(element.getAttribute(attribute), language));
      }
    }
  }

  const api = { DEFAULT_LANGUAGE, SUPPORTED_LANGUAGES, LANGUAGE_NAMES, normalizeLanguage, translate, formatRelativeTime, localizeTree };
  globalScope.ExcalidrawSyncI18n = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
