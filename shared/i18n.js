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
      "New file": "Novo arquivo", "New File": "Novo arquivo", Import: "Importar", "New folder": "Nova pasta", "New Folder": "Nova pasta", Manage: "Gerenciar", "Import link": "Importar link",
      "Search files and folders": "Pesquisar arquivos e pastas", Pinned: "Fixados", Folders: "Pastas", Unfiled: "Sem pasta", "Drop here to move to top level": "Solte aqui para mover ao nível superior",
      "No files in this folder.": "Nenhum arquivo nesta pasta.", "No matching files or folders.": "Nenhum arquivo ou pasta encontrado.",
      Settings: "Configurações", "Simple, local-first controls": "Controles simples, com armazenamento local primeiro", General: "Geral",
      "Appearance and launcher": "Aparência e atalho", Language: "Idioma", Theme: "Tema", "Follow Excalidraw": "Seguir o Excalidraw", System: "Sistema", Light: "Claro", Dark: "Escuro",
      "Floating launcher": "Atalho flutuante", "Show ExcaliSync on the canvas": "Mostrar o ExcaliSync na tela", "Hide collapsed sidebar": "Ocultar barra lateral recolhida", "Open it from the ExcaliSync icon or browser extension button": "Abra pelo ícone do ExcaliSync ou pelo botão da extensão no navegador", Saving: "Salvamento",
      "Local copies are always written first": "As cópias locais são sempre salvas primeiro", "Local first": "Local primeiro",
      Autosave: "Salvamento automático", "After every edit": "Após cada edição", "On a timer": "Por intervalo", Manual: "Manual",
      Interval: "Intervalo", "Cloud sync after editing": "Sincronizar na nuvem após editar", "Warn if pending": "Avisar se estiver pendente", Notifications: "Notificações", "Show save and sync alerts": "Mostrar alertas de salvamento e sincronização",
      "Local save": "Salvamento local", "Cloud sync": "Sincronização na nuvem", "Not connected": "Não conectado", "Local storage": "Armazenamento local",
      "Disk copy plus browser recovery copy": "Cópia no disco e cópia de recuperação do navegador", Connected: "Conectado", "Helper needed": "Auxiliar necessário",
      "Open vault": "Abrir pasta", "Delete files": "Excluir arquivos", "Expand a provider to configure it": "Expanda um provedor para configurá-lo",
      Repository: "Repositório", Visibility: "Visibilidade", Private: "Privado", Public: "Público", "Root folder": "Pasta raiz", Folder: "Pasta",
      "Link sharing": "Compartilhamento por link", Connect: "Conectar", Reconnect: "Reconectar", Disconnect: "Desconectar", "Save changes": "Salvar alterações", "Changes save automatically": "As alterações são salvas automaticamente", "Saving changes…": "Salvando alterações…", "Settings saved automatically": "Configurações salvas automaticamente", "Could not save settings automatically": "Não foi possível salvar as configurações automaticamente",
      Clear: "Limpar", "No alerts. Your drawings are up to date.": "Nenhum alerta. Seus desenhos estão atualizados.",
      "Automatic sync on": "Sincronização automática ativada", "Automatic sync off": "Sincronização automática desativada", "Auto on": "Auto ativa", "Auto off": "Auto inativa",
      "Waiting for first sync": "Aguardando a primeira sincronização", "Needs attention": "Requer atenção", "Sync all documents now": "Sincronizar todos os documentos agora",
      "Close sidebar": "Fechar barra lateral", "Back to files": "Voltar aos arquivos", "Create a GitHub OAuth App": "Criar um aplicativo OAuth do GitHub",
      "Create a Google OAuth client": "Criar um cliente OAuth do Google", "Open GitHub": "Abrir GitHub", "Enter this code on GitHub": "Digite este código no GitHub",
      "Download": "Baixar", "Refresh": "Atualizar", "ExcaliSync local vault": "Pasta local do ExcaliSync", "Your browser-local copy of every Excalidraw document.": "Sua cópia local de cada documento do Excalidraw.",
      "Sync authority": "Fonte principal da sincronização", "Local only": "Somente local", "Folder actions": "Ações da pasta",
      "Import from file": "Importar de arquivo", "Import from link": "Importar de link", "Sort files": "Ordenar arquivos",
      "Order folders and files": "Ordenar pastas e arquivos", "Folder order": "Ordem das pastas", "File order": "Ordem dos arquivos",
      "Custom (drag and drop)": "Personalizada (arrastar e soltar)", Alphabetically: "Alfabeticamente", "Last updated": "Última atualização",
      "Rename folder": "Renomear pasta", "Delete folder": "Excluir pasta", "Saved locally.": "Salvo localmente.",
      "New subfolder": "Nova subpasta", "Move folder": "Mover pasta", "Parent folder": "Pasta principal", "Top level": "Nível superior",
      Trash: "Lixeira", "Review Trash": "Revisar lixeira", Restore: "Restaurar", "Trash is empty.": "A lixeira está vazia.", "Back to settings": "Voltar às configurações", "Recover items deleted during the last 30 days": "Recupere itens excluídos nos últimos 30 dias", "Recover deleted items for up to 30 days": "Recupere itens excluídos por até 30 dias",
      "Expand sidebar": "Expandir barra lateral", "Collapse sidebar": "Recolher barra lateral", Collapse: "Recolher",
      "File details": "Detalhes do arquivo", "Copy read-only link": "Copiar link somente leitura", "Pin file": "Fixar arquivo", "Unpin file": "Desafixar arquivo", "Delete file": "Excluir arquivo",
      "Choose one cloud authority. Local storage remains the offline fallback; pending local changes merge when the selected provider is available again.": "Escolha uma fonte principal na nuvem. O armazenamento local continua sendo a alternativa offline; as alterações locais pendentes são mescladas quando o provedor selecionado volta a ficar disponível.",
    },
    es: {
      "New file": "Nuevo archivo", "New File": "Nuevo archivo", Import: "Importar", "New folder": "Nueva carpeta", "New Folder": "Nueva carpeta", Manage: "Administrar", "Import link": "Importar enlace",
      "Search files and folders": "Buscar archivos y carpetas", Pinned: "Fijados", Folders: "Carpetas", Unfiled: "Sin carpeta", "Drop here to move to top level": "Suelta aquí para mover al nivel superior",
      "No files in this folder.": "No hay archivos en esta carpeta.", "No matching files or folders.": "No se encontraron archivos ni carpetas.",
      Settings: "Configuración", "Simple, local-first controls": "Controles simples con prioridad local", General: "General", "Appearance and launcher": "Apariencia y acceso",
      Language: "Idioma", Theme: "Tema", "Follow Excalidraw": "Seguir Excalidraw", System: "Sistema", Light: "Claro", Dark: "Oscuro", "Floating launcher": "Acceso flotante", "Show ExcaliSync on the canvas": "Mostrar ExcaliSync en el lienzo", "Hide collapsed sidebar": "Ocultar barra lateral contraída", "Open it from the ExcaliSync icon or browser extension button": "Ábrela desde el icono de ExcaliSync o el botón de la extensión del navegador",
      Saving: "Guardado", "Local copies are always written first": "Las copias locales siempre se guardan primero", "Local first": "Local primero", Autosave: "Guardado automático",
      "After every edit": "Después de cada edición", "On a timer": "Por intervalo", Manual: "Manual", Interval: "Intervalo", "Cloud sync after editing": "Sincronizar en la nube después de editar", "Warn if pending": "Avisar si está pendiente",
      Notifications: "Notificaciones", "Show save and sync alerts": "Mostrar alertas de guardado y sincronización", "Local save": "Guardado local", "Cloud sync": "Sincronización en la nube",
      "Not connected": "No conectado", "Local storage": "Almacenamiento local", "Disk copy plus browser recovery copy": "Copia en disco y copia de recuperación del navegador",
      Connected: "Conectado", "Helper needed": "Se necesita el auxiliar", "Open vault": "Abrir carpeta", "Delete files": "Eliminar archivos",
      "Expand a provider to configure it": "Expande un proveedor para configurarlo", Repository: "Repositorio", Visibility: "Visibilidad", Private: "Privado", Public: "Público",
      "Root folder": "Carpeta raíz", Folder: "Carpeta", "Link sharing": "Compartir por enlace", Connect: "Conectar", Reconnect: "Reconectar", Disconnect: "Desconectar",
      "Save changes": "Guardar cambios", "Changes save automatically": "Los cambios se guardan automáticamente", "Saving changes…": "Guardando cambios…", "Settings saved automatically": "Configuración guardada automáticamente", "Could not save settings automatically": "No se pudo guardar la configuración automáticamente", Clear: "Limpiar", "No alerts. Your drawings are up to date.": "No hay alertas. Tus dibujos están actualizados.",
      "Automatic sync on": "Sincronización automática activada", "Automatic sync off": "Sincronización automática desactivada", "Auto on": "Auto activa", "Auto off": "Auto inactiva",
      "Waiting for first sync": "Esperando la primera sincronización", "Needs attention": "Requiere atención", "Sync all documents now": "Sincronizar todos los documentos ahora",
      "Close sidebar": "Cerrar barra lateral", "Back to files": "Volver a los archivos", "Create a GitHub OAuth App": "Crear una aplicación OAuth de GitHub",
      "Create a Google OAuth client": "Crear un cliente OAuth de Google", "Open GitHub": "Abrir GitHub", "Enter this code on GitHub": "Introduce este código en GitHub",
      Download: "Descargar", Refresh: "Actualizar", "ExcaliSync local vault": "Carpeta local de ExcaliSync", "Your browser-local copy of every Excalidraw document.": "Tu copia local de cada documento de Excalidraw.",
      "Sync authority": "Fuente principal de sincronización", "Local only": "Solo local", "Folder actions": "Acciones de carpeta",
      "Import from file": "Importar desde archivo", "Import from link": "Importar desde enlace", "Sort files": "Ordenar archivos",
      "Order folders and files": "Ordenar carpetas y archivos", "Folder order": "Orden de carpetas", "File order": "Orden de archivos",
      "Custom (drag and drop)": "Personalizado (arrastrar y soltar)", Alphabetically: "Alfabéticamente", "Last updated": "Última actualización",
      "Rename folder": "Renombrar carpeta", "Delete folder": "Eliminar carpeta", "Saved locally.": "Guardado localmente.",
      "New subfolder": "Nueva subcarpeta", "Move folder": "Mover carpeta", "Parent folder": "Carpeta superior", "Top level": "Nivel superior",
      Trash: "Papelera", "Review Trash": "Revisar papelera", Restore: "Restaurar", "Trash is empty.": "La papelera está vacía.", "Back to settings": "Volver a la configuración", "Recover items deleted during the last 30 days": "Recupera elementos eliminados durante los últimos 30 días", "Recover deleted items for up to 30 days": "Recupera elementos eliminados durante un máximo de 30 días",
      "Expand sidebar": "Expandir barra lateral", "Collapse sidebar": "Contraer barra lateral", Collapse: "Contraer",
      "File details": "Detalles del archivo", "Copy read-only link": "Copiar enlace de solo lectura", "Pin file": "Fijar archivo", "Unpin file": "Desfijar archivo", "Delete file": "Eliminar archivo",
      "Choose one cloud authority. Local storage remains the offline fallback; pending local changes merge when the selected provider is available again.": "Elige una fuente principal en la nube. El almacenamiento local sigue siendo la alternativa sin conexión; los cambios locales pendientes se combinan cuando el proveedor seleccionado vuelve a estar disponible.",
    },
    fr: {
      "New file": "Nouveau fichier", "New File": "Nouveau fichier", Import: "Importer", "New folder": "Nouveau dossier", "New Folder": "Nouveau dossier", Manage: "Gérer", "Import link": "Importer un lien",
      "Search files and folders": "Rechercher des fichiers et dossiers", Pinned: "Épinglés", Folders: "Dossiers", Unfiled: "Non classés", "Drop here to move to top level": "Déposez ici pour déplacer au niveau supérieur",
      "No files in this folder.": "Aucun fichier dans ce dossier.", "No matching files or folders.": "Aucun fichier ou dossier correspondant.",
      Settings: "Paramètres", "Simple, local-first controls": "Contrôles simples, stockage local prioritaire", General: "Général", "Appearance and launcher": "Apparence et lanceur",
      Language: "Langue", Theme: "Thème", "Follow Excalidraw": "Suivre Excalidraw", System: "Système", Light: "Clair", Dark: "Sombre", "Floating launcher": "Lanceur flottant", "Show ExcaliSync on the canvas": "Afficher ExcaliSync sur le canevas", "Hide collapsed sidebar": "Masquer la barre latérale réduite", "Open it from the ExcaliSync icon or browser extension button": "Ouvrez-la depuis l’icône ExcaliSync ou le bouton de l’extension du navigateur",
      Saving: "Enregistrement", "Local copies are always written first": "Les copies locales sont toujours enregistrées en premier", "Local first": "Local d'abord", Autosave: "Enregistrement automatique",
      "After every edit": "Après chaque modification", "On a timer": "Selon un intervalle", Manual: "Manuel", Interval: "Intervalle", "Cloud sync after editing": "Synchroniser le cloud après modification", "Warn if pending": "Avertir si en attente",
      Notifications: "Notifications", "Show save and sync alerts": "Afficher les alertes d'enregistrement et de synchronisation", "Local save": "Enregistrement local", "Cloud sync": "Synchronisation cloud",
      "Not connected": "Non connecté", "Local storage": "Stockage local", "Disk copy plus browser recovery copy": "Copie disque et copie de récupération du navigateur",
      Connected: "Connecté", "Helper needed": "Assistant requis", "Open vault": "Ouvrir le dossier", "Delete files": "Supprimer les fichiers",
      "Expand a provider to configure it": "Développez un fournisseur pour le configurer", Repository: "Dépôt", Visibility: "Visibilité", Private: "Privé", Public: "Public",
      "Root folder": "Dossier racine", Folder: "Dossier", "Link sharing": "Partage par lien", Connect: "Connecter", Reconnect: "Reconnecter", Disconnect: "Déconnecter",
      "Save changes": "Enregistrer", "Changes save automatically": "Les modifications sont enregistrées automatiquement", "Saving changes…": "Enregistrement des modifications…", "Settings saved automatically": "Paramètres enregistrés automatiquement", "Could not save settings automatically": "Impossible d’enregistrer automatiquement les paramètres", Clear: "Effacer", "No alerts. Your drawings are up to date.": "Aucune alerte. Vos dessins sont à jour.",
      "Automatic sync on": "Synchronisation automatique activée", "Automatic sync off": "Synchronisation automatique désactivée", "Auto on": "Auto active", "Auto off": "Auto inactive",
      "Waiting for first sync": "En attente de la première synchronisation", "Needs attention": "Attention requise", "Sync all documents now": "Synchroniser tous les documents",
      "Close sidebar": "Fermer la barre latérale", "Back to files": "Retour aux fichiers", "Create a GitHub OAuth App": "Créer une application OAuth GitHub",
      "Create a Google OAuth client": "Créer un client OAuth Google", "Open GitHub": "Ouvrir GitHub", "Enter this code on GitHub": "Saisissez ce code sur GitHub",
      Download: "Télécharger", Refresh: "Actualiser", "ExcaliSync local vault": "Dossier local ExcaliSync", "Your browser-local copy of every Excalidraw document.": "Votre copie locale de chaque document Excalidraw.",
      "Sync authority": "Source principale de synchronisation", "Local only": "Local uniquement", "Folder actions": "Actions du dossier",
      "Import from file": "Importer depuis un fichier", "Import from link": "Importer depuis un lien", "Sort files": "Trier les fichiers",
      "Order folders and files": "Trier les dossiers et les fichiers", "Folder order": "Ordre des dossiers", "File order": "Ordre des fichiers",
      "Custom (drag and drop)": "Personnalisé (glisser-déposer)", Alphabetically: "Alphabétique", "Last updated": "Dernière modification",
      "Rename folder": "Renommer le dossier", "Delete folder": "Supprimer le dossier", "Saved locally.": "Enregistré localement.",
      "New subfolder": "Nouveau sous-dossier", "Move folder": "Déplacer le dossier", "Parent folder": "Dossier parent", "Top level": "Niveau supérieur",
      Trash: "Corbeille", "Review Trash": "Voir la corbeille", Restore: "Restaurer", "Trash is empty.": "La corbeille est vide.", "Back to settings": "Retour aux paramètres", "Recover items deleted during the last 30 days": "Récupérez les éléments supprimés au cours des 30 derniers jours", "Recover deleted items for up to 30 days": "Récupérez les éléments supprimés pendant 30 jours maximum",
      "Expand sidebar": "Développer la barre latérale", "Collapse sidebar": "Réduire la barre latérale", Collapse: "Réduire",
      "File details": "Détails du fichier", "Copy read-only link": "Copier le lien en lecture seule", "Pin file": "Épingler le fichier", "Unpin file": "Désépingler le fichier", "Delete file": "Supprimer le fichier",
      "Choose one cloud authority. Local storage remains the offline fallback; pending local changes merge when the selected provider is available again.": "Choisissez une source cloud principale. Le stockage local reste la solution hors ligne; les modifications locales en attente sont fusionnées lorsque le fournisseur sélectionné redevient disponible.",
    },
    de: {
      "New file": "Neue Datei", "New File": "Neue Datei", Import: "Importieren", "New folder": "Neuer Ordner", "New Folder": "Neuer Ordner", Manage: "Verwalten", "Import link": "Link importieren",
      "Search files and folders": "Dateien und Ordner suchen", Pinned: "Angeheftet", Folders: "Ordner", Unfiled: "Nicht zugeordnet", "Drop here to move to top level": "Hier ablegen, um auf die oberste Ebene zu verschieben",
      "No files in this folder.": "Keine Dateien in diesem Ordner.", "No matching files or folders.": "Keine passenden Dateien oder Ordner.",
      Settings: "Einstellungen", "Simple, local-first controls": "Einfache Steuerung mit lokalem Speicher zuerst", General: "Allgemein", "Appearance and launcher": "Darstellung und Starter",
      Language: "Sprache", Theme: "Design", "Follow Excalidraw": "Excalidraw folgen", System: "System", Light: "Hell", Dark: "Dunkel", "Floating launcher": "Schwebender Starter", "Show ExcaliSync on the canvas": "ExcaliSync auf der Zeichenfläche anzeigen", "Hide collapsed sidebar": "Eingeklappte Seitenleiste ausblenden", "Open it from the ExcaliSync icon or browser extension button": "Über das ExcaliSync-Symbol oder die Browser-Erweiterung öffnen",
      Saving: "Speichern", "Local copies are always written first": "Lokale Kopien werden immer zuerst gespeichert", "Local first": "Lokal zuerst", Autosave: "Automatisch speichern",
      "After every edit": "Nach jeder Änderung", "On a timer": "Nach Zeitintervall", Manual: "Manuell", Interval: "Intervall", "Cloud sync after editing": "Cloud nach der Bearbeitung synchronisieren", "Warn if pending": "Bei ausstehender Speicherung warnen",
      Notifications: "Benachrichtigungen", "Show save and sync alerts": "Speicher- und Synchronisierungswarnungen anzeigen", "Local save": "Lokal gespeichert", "Cloud sync": "Cloud-Synchronisierung",
      "Not connected": "Nicht verbunden", "Local storage": "Lokaler Speicher", "Disk copy plus browser recovery copy": "Festplattenkopie plus Browser-Wiederherstellung",
      Connected: "Verbunden", "Helper needed": "Hilfsprogramm erforderlich", "Open vault": "Ordner öffnen", "Delete files": "Dateien löschen",
      "Expand a provider to configure it": "Anbieter zum Konfigurieren öffnen", Repository: "Repository", Visibility: "Sichtbarkeit", Private: "Privat", Public: "Öffentlich",
      "Root folder": "Stammordner", Folder: "Ordner", "Link sharing": "Linkfreigabe", Connect: "Verbinden", Reconnect: "Neu verbinden", Disconnect: "Trennen",
      "Save changes": "Änderungen speichern", "Changes save automatically": "Änderungen werden automatisch gespeichert", "Saving changes…": "Änderungen werden gespeichert…", "Settings saved automatically": "Einstellungen automatisch gespeichert", "Could not save settings automatically": "Einstellungen konnten nicht automatisch gespeichert werden", Clear: "Leeren", "No alerts. Your drawings are up to date.": "Keine Warnungen. Deine Zeichnungen sind aktuell.",
      "Automatic sync on": "Automatische Synchronisierung aktiv", "Automatic sync off": "Automatische Synchronisierung inaktiv", "Auto on": "Auto an", "Auto off": "Auto aus",
      "Waiting for first sync": "Warten auf erste Synchronisierung", "Needs attention": "Aktion erforderlich", "Sync all documents now": "Alle Dokumente jetzt synchronisieren",
      "Close sidebar": "Seitenleiste schließen", "Back to files": "Zurück zu den Dateien", "Create a GitHub OAuth App": "GitHub-OAuth-App erstellen",
      "Create a Google OAuth client": "Google-OAuth-Client erstellen", "Open GitHub": "GitHub öffnen", "Enter this code on GitHub": "Diesen Code auf GitHub eingeben",
      Download: "Herunterladen", Refresh: "Aktualisieren", "ExcaliSync local vault": "Lokaler ExcaliSync-Ordner", "Your browser-local copy of every Excalidraw document.": "Deine lokale Kopie jedes Excalidraw-Dokuments.",
      "Sync authority": "Primäre Synchronisierungsquelle", "Local only": "Nur lokal", "Folder actions": "Ordneraktionen",
      "Import from file": "Aus Datei importieren", "Import from link": "Über Link importieren", "Sort files": "Dateien sortieren",
      "Order folders and files": "Ordner und Dateien sortieren", "Folder order": "Ordnerreihenfolge", "File order": "Dateireihenfolge",
      "Custom (drag and drop)": "Benutzerdefiniert (Drag-and-drop)", Alphabetically: "Alphabetisch", "Last updated": "Zuletzt aktualisiert",
      "Rename folder": "Ordner umbenennen", "Delete folder": "Ordner löschen", "Saved locally.": "Lokal gespeichert.",
      "New subfolder": "Neuer Unterordner", "Move folder": "Ordner verschieben", "Parent folder": "Übergeordneter Ordner", "Top level": "Oberste Ebene",
      Trash: "Papierkorb", "Review Trash": "Papierkorb anzeigen", Restore: "Wiederherstellen", "Trash is empty.": "Der Papierkorb ist leer.", "Back to settings": "Zurück zu den Einstellungen", "Recover items deleted during the last 30 days": "Gelöschte Elemente der letzten 30 Tage wiederherstellen", "Recover deleted items for up to 30 days": "Gelöschte Elemente bis zu 30 Tage wiederherstellen",
      "Expand sidebar": "Seitenleiste erweitern", "Collapse sidebar": "Seitenleiste einklappen", Collapse: "Einklappen",
      "File details": "Dateidetails", "Copy read-only link": "Nur-Lese-Link kopieren", "Pin file": "Datei anheften", "Unpin file": "Datei lösen", "Delete file": "Datei löschen",
      "Choose one cloud authority. Local storage remains the offline fallback; pending local changes merge when the selected provider is available again.": "Wähle eine primäre Cloud-Quelle. Der lokale Speicher bleibt die Offline-Reserve; ausstehende lokale Änderungen werden zusammengeführt, sobald der ausgewählte Anbieter wieder verfügbar ist.",
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
