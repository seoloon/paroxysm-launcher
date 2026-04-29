'use strict';
/**
 * i18n — Paroxysm Launcher
 *
 * Usage:
 *   t('key')            → translated string
 *   t('key', {n: 42})   → with interpolation: "{{n}} mods" → "42 mods"
 *   setLang('en')       → switch language and re-render
 *   getLang()           → current language code
 */

const TRANSLATIONS = {

  // ── Français ───────────────────────────────────────────────────────────────
  fr: {
    // Nav
    'nav.library':    'Bibliothèque',
    'nav.browse':     'Explorer',
    'nav.profile':    'Profil',
    'nav.settings':   'Paramètres',

    // Library page
    'lib.title':          'Bibliothèque',
    'lib.loading':        'Chargement...',
    'lib.count':          '{{n}} modpack installé',
    'lib.count_plural':   '{{n}} modpacks installés',
    'lib.empty.title':    'Aucun modpack installé',
    'lib.empty.hint':     'Importez un modpack ou explorez',
    'lib.empty.hint_full':'Importez un modpack CurseForge (.zip), Modrinth (.mrpack) ou rendez-vous dans',
    'lib.empty.explore':  'l\'explorer',
    'lib.btn.import':     'Importer un modpack',
    'lib.btn.create':     'Créer une instance',
    'lib.card.play':      'JOUER',
    'lib.card.settings':  'Paramètres du modpack',
    'lib.search_ph':      'Rechercher...',

    // Browse page
    'nav.browse_title':         'Explorer',
    'browse.sub':               'Propulsé par Modrinth · mods, modpacks, shaders, ressources',
    'browse.search':            'Rechercher un modpack, mod, shader...',
    'browse.search_modrinth':   'Rechercher sur Modrinth...',
    'browse.all_versions':      'Toutes versions',
    'browse.all_loaders':       'Tous loaders',
    'browse.loading':           'Chargement depuis Modrinth...',
    'browse.no_results':        'Aucun résultat trouvé',
    'browse.load_more':         'Charger plus',
    'browse.installs':          '{{n}} installations',
    'browse.followers':         '{{n}} abonnés',
    'browse.type.modpack':      'Modpacks',
    'browse.type.mod':          'Mods',
    'browse.type.shader':       'Shaders',
    'browse.type.resourcepack': 'Ressources',
    'browse.sort.relevance':    'Pertinence',
    'browse.sort.downloads':    'Téléchargements',
    'browse.sort.follows':      'Popularité',
    'browse.sort.newest':       'Nouveautés',
    'browse.sort.updated':      'Mis à jour',
    'browse.by':                'par',
    'browse.type_label.modpack':'Modpack',
    'browse.type_label.mod':    'Mod',
    'browse.type_label.shader': 'Shader',
    'browse.type_label.resourcepack': 'Pack de ressources',
    'browse.quick_add_title':   'Installer dans une instance',
    'browse.quick_add_done':    'Ajouté dans {{instance}}',

    // Profile page
    'profile.title':              'Profil',
    'profile.sub':                'Gestion du joueur et de la session',
    'profile.ms_account':         'Compte Microsoft',
    'profile.btn.login':          'Se connecter avec Microsoft',
    'profile.btn.logout':         'Se déconnecter',
    'profile.offline':            'Mode hors-ligne',
    'profile.username_label':     'Nom d\'utilisateur',
    'profile.username':           'Votre pseudo',
    'profile.username_hint':      'Utilisé si non connecté ou si le mode hors-ligne est forcé.',
    'profile.force_offline':      'Forcer le hors-ligne',
    'profile.force_offline_hint': 'Ignorer le compte Microsoft',
    'profile.btn.save':           'Sauvegarder',
    'auth.required':              'Requis pour jouer sur les serveurs officiels et les Realms.',
    'auth.opening_browser':       'Ouverture du navigateur...',
    'auth.browser_hint':          'Connectez-vous dans votre navigateur puis revenez ici.',
    'auth.connected_as':          'Connecté en tant que',
    'auth.not_connected':         'Non connecté',
    'auth.logging_in':            'Connexion en cours...',
    'auth.browser_opened':        'Navigateur ouvert — connectez-vous puis revenez ici.',
    'auth.device_code_label':     'Code Microsoft : {{code}}',
    'auth.device_code_hint':      'Si nécessaire, entrez ce code sur microsoft.com/devicelogin.',
    'auth.copy_code':             'Copier le code',
    'auth.code_copied':           'Code copié dans le presse-papiers.',
    'auth.verifying_mc':          'Vérification du compte Minecraft...',
    'auth.logout_confirm':        'Se déconnecter ?',
    'dialog.confirm_title':       'Confirmation',
    'dialog.cancel':              'Annuler',
    'dialog.confirm':             'Confirmer',
    'dialog.delete':              'Supprimer',

    // Settings page
    'settings.title':              'Paramètres',
    'settings.sub':                'Configuration du système',
    'settings.perf':               'Performances',
    'settings.ram_label':          'RAM allouée',
    'settings.ram_hint':           'Recommandé : 4-8 GB pour Forge, 2-4 GB pour Fabric.',
    'settings.ram_warning_high':   '⚠ Attention — seulement {{left}} GB restants pour le système. Risque de crash ou de freeze.',
    'settings.ram_warning_medium': '⚠ Plus assez de RAM allouée au système ({{left}} GB restants). Risque de lenteurs.',
    'settings.datadir':            'Dossier de données',
    'settings.datadir_label':      'Chemin Paroxysm',
    'settings.btn.opendir':        'Ouvrir',
    'settings.cf_key':             'Clé API CurseForge',
    'settings.cf_key_opt':         '(optionnel)',
    'settings.cf_key_hint_full':   'Améliore la fiabilité des téléchargements. Obtenez une clé gratuite sur <a id="cf-link" href="#">console.curseforge.com</a>.',
    'settings.language':           'Langue',
    'settings.language_sub':       'Langue de l\'interface',
    'settings.rpc.toggle':         'Discord Rich Presence',
    'settings.rpc.toggle_hint':    'Affiche ton statut dans Discord (bibliothèque, navigation, jeu en cours).',
    'settings.updates':            'Mises \u00e0 jour',
    'settings.update_channel':     'Canal de mise \u00e0 jour',
    'settings.update_channel_stable': 'Stable',
    'settings.update_channel_beta':   'Beta',
    'settings.update_channel_hint':   'Stable privil\u00e9gie la fiabilit\u00e9. B\u00eata re\u00e7oit les nouvelles versions en avance.',
    'settings.btn.check_updates':  'V\u00e9rifier les mises \u00e0 jour',
    'settings.btn.install_update': 'Red\u00e9marrer et installer',
    'settings.update_status_idle': 'V\u00e9rification des mises \u00e0 jour inactive.',
    'settings.update_status_checking': 'V\u00e9rification des mises \u00e0 jour...',
    'settings.update_status_up_to_date': 'Aucune mise \u00e0 jour disponible (v{{version}}).',
    'settings.update_status_downloading': 'T\u00e9l\u00e9chargement de la mise \u00e0 jour... {{percent}}%',
    'settings.update_status_downloaded': 'Mise \u00e0 jour {{version}} pr\u00eate. Red\u00e9marrez pour installer.',
    'settings.update_status_error': 'Erreur de mise \u00e0 jour: {{message}}',
    'settings.update_status_disabled': 'Mise \u00e0 jour auto indisponible: {{message}}',
    'settings.update_reason_missing_module': 'module electron-updater manquant.',
    'settings.update_reason_dev_mode': 'mode d\u00e9veloppement.',
    'settings.tab.launcher':       'Launcher',
    'settings.tab.java':           'Java',
    'settings.tab.defaults':       'Instance par d\u00e9faut',
    'settings.tab.resources':      'Ressources',
    'settings.java.title':         'Installations Java',
    'settings.java.hint':          'Chaque ligne peut utiliser le Java d\u00e9tect\u00e9 automatiquement ou un binaire personnalis\u00e9. Utilisez Test pour valider rapidement.',
    'settings.java.btn.install':   'Installer recommand\u00e9',
    'settings.java.btn.browse':    'Parcourir',
    'settings.java.btn.test':      'Tester',
    'settings.java.status.not_found': 'Introuvable',
    'settings.java.status.custom_ok': 'Personnalis\u00e9 OK (Java {{major}})',
    'settings.java.status.custom_invalid': 'Personnalis\u00e9 invalide{{reason}}',
    'settings.java.status.auto':   'Auto ({{source}}) Java {{version}}',
    'settings.java.status.missing': 'Absent',
    'settings.java.action_ok':     'Java {{major}}: OK',
    'settings.defaults.title':     'Param\u00e8tres d\u2019instance par d\u00e9faut',
    'settings.defaults.hint':      'Ces valeurs s\u2019appliquent quand une instance n\u2019a pas d\u2019override local dans ses param\u00e8tres.',
    'settings.defaults.fullscreen': 'Plein \u00e9cran',
    'settings.defaults.fullscreen_hint': 'Lance Minecraft en mode plein \u00e9cran.',
    'settings.defaults.width':     'Largeur',
    'settings.defaults.height':    'Hauteur',
    'settings.defaults.java_args': 'Arguments Java',
    'settings.defaults.env_vars':  'Variables d\u2019environnement',
    'settings.defaults.env_vars_hint': 'Une variable par ligne au format KEY=VALUE.',
    'settings.resources.title':    'Gestion des ressources',
    'settings.resources.app_dir':  'Dossier de l\u2019application',
    'settings.resources.app_cache': 'Cache de l\u2019application',
    'settings.resources.purge':    'Purger',
    'settings.resources.concurrency': 'Concurrence',
    'settings.resources.max_downloads': 'T\u00e9l\u00e9chargements concurrents max',
    'settings.resources.max_writes': 'Ecritures concurrentes max',
    'settings.resources.max_downloads_hint': 'Nombre de t\u00e9l\u00e9chargements r\u00e9seau simultan\u00e9s pendant les installations.',
    'settings.resources.max_writes_hint': 'Limite les \u00e9critures disque parall\u00e8les pour r\u00e9duire la charge I/O.',
    'settings.resources.cache_size': 'Taille du cache: {{size}}',
    'settings.resources.cache_purged': 'Cache purg\u00e9',
    'settings.cf_key_label':       'Cl\u00e9 API',
    'settings.btn.save':           'Sauvegarder',
    'settings.saved':              '✓ Sauvegardé',
    'settings.ram_system':         '(système : {{n}} GB)',

    // Pack page — hero
    'pack.play':      'JOUER',
    'pack.add_content':'Ajouter du contenu',
    'pack.add_content_title':'Ouvrir l\'explorer avec les filtres de cette instance',
    'pack.kill':      'KILL INSTANCE',
    'pack.killing':   'ARRÊT...',
    'pack.play_verb': 'Jouer',
    'pack.back':      'Retour',

    // Pack page — tabs
    'pack.tab.overview':  'Vue d\'ensemble',
    'pack.tab.content':   'Contenu',
    'pack.tab.logs':      'Logs',
    'pack.tab.settings':  'Paramètres',

    // Pack page — overview stats
    'pack.stat.mc':       'Minecraft',
    'pack.stat.loader':   'Modloader',
    'pack.stat.mods':     'Mods',
    'pack.stat.played':   'Dernier jeu',
    'pack.stat.format':   'Format',
    'pack.stat.added':    'Installé le',
    'pack.never_played':  'Jamais',
    'pack.failed_title':  '⚠ Mods en échec lors de l\'installation',

    // Pack page — content tab
    'pack.content.filter.all':    'Tous',
    'pack.content.filter.mod':    'Mods',
    'pack.content.filter.shader': 'Shaders',
    'pack.content.filter.res':    'Ressources',
    'pack.content.filter.config': 'Configs',
    'pack.content.search':        'Filtrer les fichiers...',
    'pack.content.empty':         'Aucun fichier',
    'pack.content.resolve':       'Noms numériques détectés',
    'pack.content.resolve_btn':   'Résoudre',
    'pack.content.resolve_working': 'Résolution...',
    'pack.content.resolve_done':    '✓ {{n}} noms résolus',
    'pack.content.resolve_uptodate':'✓ Déjà à jour',
    'pack.content.resolve_error':   'Erreur',
    'pack.content.stats.mod':       'Mods',
    'pack.content.stats.shader':    'Shaders',
    'pack.content.stats.resourcepack':'Ressources',
    'pack.content.stats.config':    'Configs',
    'pack.content.stats.other':     'Autres',
    'pack.content.stats.shown':     '{{n}} affichés',
    'pack.info.name':               'Nom',
    'pack.info.version':            'Version',
    'pack.info.mc':                 'MC',
    'pack.info.loader':             'Loader',
    'pack.info.mods':               'Mods',

    // Pack page — logs tab
    'pack.logs.copy':     'Copier tout',
    'pack.logs.clear':    'Effacer vue',
    'pack.logs.select':   'Sélectionnez un fichier de log ci-dessous',
    'pack.logs.live':     'LOG EN DIRECT',
    'pack.logs.copied':   'Copié !',
    'pack.logs.copied_button':'✓ Copié !',
    'pack.logs.loading':  'Chargement...',
    'pack.logs.read_error':'Impossible de lire le fichier',
    'pack.logs.lines':    '{{n}} lignes',

    // Pack page — settings tab
    'pack.settings.identity':         'Identité',
    'pack.settings.icon':             'Icône',
    'pack.settings.icon_pick':        'Choisir une image...',
    'pack.settings.icon_reset':       'Réinitialiser',
    'pack.settings.custom_name':      'Nom personnalisé',
    'pack.settings.custom_name_ph':   'Nom d\'affichage...',
    'pack.settings.custom_name_hint': 'Laissez vide pour utiliser le nom d\'origine.',
    'pack.settings.notes':            'Notes',
    'pack.settings.notes_ph':         'Notes personnelles sur ce modpack...',
    'pack.settings.perf':             'Performance',
    'pack.settings.ram_label':        'RAM dédiée',
    'pack.settings.ram_global':       'Global',
    'pack.settings.ram_hint':         '0 = utiliser la valeur globale des',
    'pack.settings.ram_hint2':        'paramètres.',
    'pack.settings.ram_hint3':        'Sinon, définit une valeur spécifique pour ce modpack uniquement.',
    'pack.settings.ram_warning_high': '⚠ Attention — seulement {{left}} GB restants pour le système. Risque de crash ou de freeze.',
    'pack.settings.ram_warning_medium':'⚠ Plus assez de RAM allouée au système ({{left}} GB restants). Risque de lenteurs.',
    'pack.settings.ram_system':       '(système : {{n}} GB)',
    'pack.settings.danger':           'Zone de danger',
    'pack.settings.open_folder':      'Ouvrir le dossier',
    'pack.settings.delete':           'Supprimer le modpack',
    'pack.settings.save':             'Sauvegarder',
	    'pack.settings.fullscreen':       'Plein \u00e9cran',
	    'pack.settings.fullscreen_hint':  'Override local de l\u2019instance.',
	    'pack.settings.use_global_resolution': 'Utiliser la r\u00e9solution globale',
	    'pack.settings.use_global_resolution_hint': 'Reprend la r\u00e9solution des param\u00e8tres globaux.',
	    'pack.settings.width':            'Largeur',
	    'pack.settings.height':           'Hauteur',
    'pack.settings.java_args':        'Arguments Java',
    'pack.settings.env_vars':         'Variables d\u2019environnement',
    'pack.settings.saved':            '✓ Sauvegardé',

    // Install modal
    'install.title':         'Installation en cours',
    'install.preparing':     'En attente...',
    'install.btn.cancel':    'Annuler',
    'install.step.java':     'Java',
    'install.step.modloader':'Minecraft + Modloader',
    'install.step.mods':     'Mods',
    'install.step.overrides':'Configs & Overrides',
    'install.done':          'Terminé !',
    'install.modal_title_file':'Installation — {{file}}',

    // Create instance modal
    'create.title':            'Créer une instance',
    'create.mc_version':       'Version Minecraft',
    'create.loader':           'Modloader',
    'create.loader_vanilla':   'Vanilla',
    'create.loader_version':   'Version du modloader',
    'create.name':             'Nom de l\'instance',
    'create.name_ph':          'Mon instance...',
    'create.btn.create':       'Créer',
    'create.btn.cancel':       'Annuler',
    'create.loading_versions': 'Chargement des versions...',
    'create.select_mc_first':  'Sélectionnez d\'abord une version MC...',
    'create.loading':          'Chargement...',
    'create.load_error':       'Erreur de chargement',
    'create.select_version':   'Sélectionnez une version...',
    'create.loading_loader_versions': 'Chargement des versions...',
    'create.no_versions':      'Aucune version disponible',
    'create.vanilla_no_loader':'Aucun (Vanilla)',
    'create.modal_title':      'Création — {{name}}',

    // Modrinth download modal
    'mr.download.title':  'Télécharger',
    'mr.download.version':'Version',
    'mr.download.btn':    'Télécharger',
    'mr.download.cancel': 'Annuler',
    'mr.downloaded':      '✓ Téléchargé',
    'mr.download_import_confirm': '"{{file}}" téléchargé !\nImporter ce modpack maintenant ?',
    'mr.retry':           'Réessayer',
    'mr.loading':         'Chargement...',
    'mr.followers':       'Followers',
    'mr.versions':        'Versions',
    'mr.versions_count':  'Versions ({{n}})',
    'mr.filter.all_mc':   'Toutes MC',
    'mr.filter.all_loaders': 'Tous loaders',
    'mr.no_versions':     'Aucune version disponible.',
    'mr.project':         'Projet',

    // Content overlay
    'overlay.title':      'Contenu du modpack',
    'overlay.files':      'Fichiers',
    'overlay.search':     'Filtrer...',
    'overlay.search_file':'Rechercher un fichier...',
    'overlay.filter_ph':  'Filtrer...',
    'overlay.empty':      'Aucun fichier dans cette catégorie',

    // Play panel
    'play_panel.info':    'Informations',
    'play_panel.expand':  'Ouvrir en plein écran',

    // Instance picker modal
    'inst_pick.title':      'Choisir une instance',
    'inst_pick.empty':      'Aucune instance compatible trouvée.',
    'inst_pick.empty_hint': 'Vérifiez la version MC et le modloader.',
    'inst_pick.install_title': 'Installer dans une instance',
    'inst_pick.install_where': 'Où souhaitez-vous installer ce {{type}} ?',
    'inst_pick.current_instance':'Instance actuelle',
    'inst_pick.incompatible':  'Incompatibles',
    'inst_pick.version_unknown':'Version inconnue',
    'inst_pick.require_mc':    'MC {{versions}} requis',
    'inst_pick.require_loader':'Loader: {{loaders}} requis',
    'inst_pick.no_instances':  'Aucune instance installée. Créez ou importez un modpack d\'abord.',
    'inst_pick.type.mod':      'mod',
    'inst_pick.type.shader':   'shader',
    'inst_pick.type.resourcepack': 'pack de ressources',
    'inst_pick.type.datapack': 'data pack',
    'inst_pick.type.file':     'fichier',

    // Delete confirm
    'delete.confirm':      'Supprimer "{{name}}" ? Cette action est irréversible.',
    'delete.confirm_full': 'Supprimer "{{name}}" ?\nTous les fichiers seront supprimés.',

    // Status
    'status.running': 'En cours d\'exécution',
    'status.stopped': 'Arrêté',
    'status.online':  'En ligne',
    'status.offline': 'Hors-ligne',
    'status.minecraft_launched': '✓ Minecraft lancé (PID {{pid}})',
    'status.kill_sent':          'Demande d\'arrêt envoyée...',
    'status.stopped_code':       'Arrêté (code {{code}})',
    'modal.error_prefix':        '❌',
    'error.generic':             'Erreur',
    'error.unknown':             'inconnue',
    'badge.custom':              'Custom',
    'app.error_no_px':           'ERREUR: window.px non disponible.',
    'error.launch_failed':   'Échec du lancement',
    'error.install_failed':  'Échec de l\'installation',
  },

  // ── English ────────────────────────────────────────────────────────────────
  en: {
    // Nav
    'nav.library':    'Library',
    'nav.browse':     'Browse',
    'nav.profile':    'Profile',
    'nav.settings':   'Settings',

    // Library page
    'lib.title':          'Library',
    'lib.loading':        'Loading...',
    'lib.count':          '{{n}} modpack installed',
    'lib.count_plural':   '{{n}} modpacks installed',
    'lib.empty.title':    'No modpacks installed',
    'lib.empty.hint':     'Import a modpack or',
    'lib.empty.hint_full':'Import a CurseForge (.zip) or Modrinth (.mrpack) modpack, or head to',
    'lib.empty.explore':  'browse',
    'lib.btn.import':     'Import a modpack',
    'lib.btn.create':     'Create instance',
    'lib.card.play':      'PLAY',
    'lib.card.settings':  'Modpack settings',
    'lib.search_ph':      'Search...',

    // Browse page — "Browse" is kept as a cool name (like Explorer in FR)
    'nav.browse_title':         'Explorer',
    'browse.sub':               'Powered by Modrinth · mods, modpacks, shaders, resources',
    'browse.search':            'Search for a modpack, mod, shader...',
    'browse.search_modrinth':   'Search on Modrinth...',
    'browse.all_versions':      'All versions',
    'browse.all_loaders':       'All loaders',
    'browse.loading':           'Loading from Modrinth...',
    'browse.no_results':        'No results found',
    'browse.load_more':         'Load more',
    'browse.installs':          '{{n}} installs',
    'browse.followers':         '{{n}} followers',
    'browse.type.modpack':      'Modpacks',
    'browse.type.mod':          'Mods',
    'browse.type.shader':       'Shaders',
    'browse.type.resourcepack': 'Resource packs',
    'browse.sort.relevance':    'Relevance',
    'browse.sort.downloads':    'Downloads',
    'browse.sort.follows':      'Popularity',
    'browse.sort.newest':       'Newest',
    'browse.sort.updated':      'Updated',
    'browse.by':                'by',
    'browse.type_label.modpack':'Modpack',
    'browse.type_label.mod':    'Mod',
    'browse.type_label.shader': 'Shader',
    'browse.type_label.resourcepack': 'Resource Pack',
    'browse.quick_add_title':   'Install to an instance',
    'browse.quick_add_done':    'Added to {{instance}}',

    // Profile page
    'profile.title':              'Profile',
    'profile.sub':                'Player and session management',
    'profile.ms_account':         'Microsoft Account',
    'profile.btn.login':          'Sign in with Microsoft',
    'profile.btn.logout':         'Sign out',
    'profile.offline':            'Offline mode',
    'profile.username_label':     'Username',
    'profile.username':           'Your username',
    'profile.username_hint':      'Used when not signed in or when offline mode is forced.',
    'profile.force_offline':      'Force offline',
    'profile.force_offline_hint': 'Ignore Microsoft account',
    'profile.btn.save':           'Save',
    'auth.required':              'Required to play on official servers and Realms.',
    'auth.opening_browser':       'Opening browser...',
    'auth.browser_hint':          'Sign in through your browser then come back here.',
    'auth.connected_as':          'Signed in as',
    'auth.not_connected':         'Not signed in',
    'auth.logging_in':            'Signing in...',
    'auth.browser_opened':        'Browser opened — sign in and come back here.',
    'auth.device_code_label':     'Microsoft code: {{code}}',
    'auth.device_code_hint':      'If needed, enter this code on microsoft.com/devicelogin.',
    'auth.copy_code':             'Copy code',
    'auth.code_copied':           'Code copied to clipboard.',
    'auth.verifying_mc':          'Verifying Minecraft account...',
    'auth.logout_confirm':        'Sign out?',
    'dialog.confirm_title':       'Confirmation',
    'dialog.cancel':              'Cancel',
    'dialog.confirm':             'Confirm',
    'dialog.delete':              'Delete',

    // Settings page
    'settings.title':              'Settings',
    'settings.sub':                'System configuration',
    'settings.perf':               'Performance',
    'settings.ram_label':          'Allocated RAM',
    'settings.ram_hint':           'Recommended: 4-8 GB for Forge, 2-4 GB for Fabric.',
    'settings.ram_warning_high':   '⚠ Warning — only {{left}} GB remaining for the system. Risk of crash or freeze.',
    'settings.ram_warning_medium': '⚠ Not enough RAM left for the system ({{left}} GB remaining). Expect slowdowns.',
    'settings.datadir':            'Data folder',
    'settings.datadir_label':      'Paroxysm path',
    'settings.btn.opendir':        'Open',
    'settings.cf_key':             'CurseForge API Key',
    'settings.cf_key_opt':         '(optional)',
    'settings.cf_key_hint_full':   'Improves download reliability. Get a free key at <a id="cf-link" href="#">console.curseforge.com</a>.',
    'settings.language':           'Language',
    'settings.language_sub':       'Interface language',
    'settings.rpc.toggle':         'Discord Rich Presence',
    'settings.rpc.toggle_hint':    'Shows your status in Discord (library, browsing, in-game).',
    'settings.updates':            'Updates',
    'settings.update_channel':     'Update channel',
    'settings.update_channel_stable': 'Stable',
    'settings.update_channel_beta':   'Beta',
    'settings.update_channel_hint':   'Stable focuses on reliability. Beta gets new builds earlier.',
    'settings.btn.check_updates':  'Check for updates',
    'settings.btn.install_update': 'Restart and install',
    'settings.update_status_idle': 'Update checks are idle.',
    'settings.update_status_checking': 'Checking for updates...',
    'settings.update_status_up_to_date': 'No update available (v{{version}}).',
    'settings.update_status_downloading': 'Downloading update... {{percent}}%',
    'settings.update_status_downloaded': 'Update {{version}} is ready. Restart to install.',
    'settings.update_status_error': 'Update error: {{message}}',
    'settings.update_status_disabled': 'Auto-update unavailable: {{message}}',
    'settings.update_reason_missing_module': 'electron-updater module is missing.',
    'settings.update_reason_dev_mode': 'development mode.',
    'settings.tab.launcher':       'Launcher',
    'settings.tab.java':           'Java',
    'settings.tab.defaults':       'Default instance',
    'settings.tab.resources':      'Resources',
    'settings.java.title':         'Java installations',
    'settings.java.hint':          'Each line can use auto-detected Java or a custom binary path. Use Test for a quick validation.',
    'settings.java.btn.install':   'Install Recommended',
    'settings.java.btn.browse':    'Browse',
    'settings.java.btn.test':      'Test',
    'settings.java.status.not_found': 'Not found',
    'settings.java.status.custom_ok': 'Custom OK (Java {{major}})',
    'settings.java.status.custom_invalid': 'Custom invalid{{reason}}',
    'settings.java.status.auto':   'Auto ({{source}}) Java {{version}}',
    'settings.java.status.missing': 'Missing',
    'settings.java.action_ok':     'Java {{major}}: OK',
    'settings.defaults.title':     'Default instance settings',
    'settings.defaults.hint':      'These values are used when an instance has no local override in its settings.',
    'settings.defaults.fullscreen': 'Fullscreen',
    'settings.defaults.fullscreen_hint': 'Launch Minecraft in fullscreen mode.',
    'settings.defaults.width':     'Width',
    'settings.defaults.height':    'Height',
    'settings.defaults.java_args': 'Java arguments',
    'settings.defaults.env_vars':  'Environment variables',
    'settings.defaults.env_vars_hint': 'One variable per line using KEY=VALUE format.',
    'settings.resources.title':    'Resource management',
    'settings.resources.app_dir':  'App directory',
    'settings.resources.app_cache': 'App cache',
    'settings.resources.purge':    'Purge',
    'settings.resources.concurrency': 'Concurrency',
    'settings.resources.max_downloads': 'Maximum concurrent downloads',
    'settings.resources.max_writes': 'Maximum concurrent writes',
    'settings.resources.max_downloads_hint': 'Number of simultaneous network downloads during installations.',
    'settings.resources.max_writes_hint': 'Limits parallel disk writes to reduce I/O pressure.',
    'settings.resources.cache_size': 'Cache size: {{size}}',
    'settings.resources.cache_purged': 'Cache purged',
    'settings.cf_key_label':       'API Key',
    'settings.btn.save':           'Save',
    'settings.saved':              '✓ Saved',
    'settings.ram_system':         '(system: {{n}} GB)',

    // Pack page — hero
    'pack.play':      'PLAY',
    'pack.add_content':'Add content',
    'pack.add_content_title':'Open browser with this instance filters',
    'pack.kill':      'KILL INSTANCE',
    'pack.killing':   'STOPPING...',
    'pack.play_verb': 'Play',
    'pack.back':      'Back',

    // Pack page — tabs
    'pack.tab.overview':  'Overview',
    'pack.tab.content':   'Content',
    'pack.tab.logs':      'Logs',
    'pack.tab.settings':  'Settings',

    // Pack page — overview stats
    'pack.stat.mc':       'Minecraft',
    'pack.stat.loader':   'Modloader',
    'pack.stat.mods':     'Mods',
    'pack.stat.played':   'Last played',
    'pack.stat.format':   'Format',
    'pack.stat.added':    'Added on',
    'pack.never_played':  'Never',
    'pack.failed_title':  '⚠ Mods that failed to install',

    // Pack page — content tab
    'pack.content.filter.all':    'All',
    'pack.content.filter.mod':    'Mods',
    'pack.content.filter.shader': 'Shaders',
    'pack.content.filter.res':    'Resources',
    'pack.content.filter.config': 'Configs',
    'pack.content.search':        'Filter files...',
    'pack.content.empty':         'No files',
    'pack.content.resolve':       'Numeric names detected',
    'pack.content.resolve_btn':   'Resolve',
    'pack.content.resolve_working': 'Resolving...',
    'pack.content.resolve_done':    '✓ {{n}} names resolved',
    'pack.content.resolve_uptodate':'✓ Up to date',
    'pack.content.resolve_error':   'Error',
    'pack.content.stats.mod':       'Mods',
    'pack.content.stats.shader':    'Shaders',
    'pack.content.stats.resourcepack':'Resources',
    'pack.content.stats.config':    'Configs',
    'pack.content.stats.other':     'Others',
    'pack.content.stats.shown':     '{{n}} shown',
    'pack.info.name':               'Name',
    'pack.info.version':            'Version',
    'pack.info.mc':                 'MC',
    'pack.info.loader':             'Loader',
    'pack.info.mods':               'Mods',

    // Pack page — logs tab
    'pack.logs.copy':     'Copy all',
    'pack.logs.clear':    'Clear view',
    'pack.logs.select':   'Select a log file below',
    'pack.logs.live':     'LIVE LOG',
    'pack.logs.copied':   'Copied!',
    'pack.logs.copied_button':'✓ Copied!',
    'pack.logs.loading':  'Loading...',
    'pack.logs.read_error':'Unable to read this file',
    'pack.logs.lines':    '{{n}} lines',

    // Pack page — settings tab
    'pack.settings.identity':         'Identity',
    'pack.settings.icon':             'Icon',
    'pack.settings.icon_pick':        'Choose an image...',
    'pack.settings.icon_reset':       'Reset',
    'pack.settings.custom_name':      'Custom name',
    'pack.settings.custom_name_ph':   'Display name...',
    'pack.settings.custom_name_hint': 'Leave empty to use the original name.',
    'pack.settings.notes':            'Notes',
    'pack.settings.notes_ph':         'Personal notes about this modpack...',
    'pack.settings.perf':             'Performance',
    'pack.settings.ram_label':        'Dedicated RAM',
    'pack.settings.ram_global':       'Global',
    'pack.settings.ram_hint':         '0 = use the global value from',
    'pack.settings.ram_hint2':        'settings.',
    'pack.settings.ram_hint3':        'Otherwise, sets a specific value for this modpack only.',
    'pack.settings.ram_warning_high': '⚠ Warning — only {{left}} GB remaining for the system. Risk of crash or freeze.',
    'pack.settings.ram_warning_medium':'⚠ Not enough RAM left for the system ({{left}} GB remaining). Expect slowdowns.',
    'pack.settings.ram_system':       '(system: {{n}} GB)',
    'pack.settings.danger':           'Danger zone',
    'pack.settings.open_folder':      'Open folder',
    'pack.settings.delete':           'Delete modpack',
    'pack.settings.save':             'Save',
	    'pack.settings.fullscreen':       'Fullscreen',
	    'pack.settings.fullscreen_hint':  'Local override for this instance.',
	    'pack.settings.use_global_resolution': 'Use global resolution',
	    'pack.settings.use_global_resolution_hint': 'Uses the resolution from global settings.',
	    'pack.settings.width':            'Width',
	    'pack.settings.height':           'Height',
    'pack.settings.java_args':        'Java arguments',
    'pack.settings.env_vars':         'Environment variables',
    'pack.settings.saved':            '✓ Saved',

    // Install modal
    'install.title':         'Installing',
    'install.preparing':     'Waiting...',
    'install.btn.cancel':    'Cancel',
    'install.step.java':     'Java',
    'install.step.modloader':'Minecraft + Modloader',
    'install.step.mods':     'Mods',
    'install.step.overrides':'Configs & Overrides',
    'install.done':          'Done!',
    'install.modal_title_file':'Install — {{file}}',

    // Create instance modal
    'create.title':            'Create instance',
    'create.mc_version':       'Minecraft version',
    'create.loader':           'Modloader',
    'create.loader_vanilla':   'Vanilla',
    'create.loader_version':   'Loader version',
    'create.name':             'Instance name',
    'create.name_ph':          'My instance...',
    'create.btn.create':       'Create',
    'create.btn.cancel':       'Cancel',
    'create.loading_versions': 'Loading versions...',
    'create.select_mc_first':  'Select a MC version first...',
    'create.loading':          'Loading...',
    'create.load_error':       'Loading error',
    'create.select_version':   'Select a version...',
    'create.loading_loader_versions': 'Loading versions...',
    'create.no_versions':      'No version available',
    'create.vanilla_no_loader':'None (Vanilla)',
    'create.modal_title':      'Create — {{name}}',

    // Modrinth download modal
    'mr.download.title':  'Download',
    'mr.download.version':'Version',
    'mr.download.btn':    'Download',
    'mr.download.cancel': 'Cancel',
    'mr.downloaded':      '✓ Downloaded',
    'mr.download_import_confirm': '"{{file}}" downloaded!\nImport this modpack now?',
    'mr.retry':           'Retry',
    'mr.loading':         'Loading...',
    'mr.followers':       'Followers',
    'mr.versions':        'Versions',
    'mr.versions_count':  'Versions ({{n}})',
    'mr.filter.all_mc':   'All MC',
    'mr.filter.all_loaders': 'All loaders',
    'mr.no_versions':     'No versions available.',
    'mr.project':         'Project',

    // Content overlay
    'overlay.title':      'Modpack content',
    'overlay.files':      'Files',
    'overlay.search':     'Filter...',
    'overlay.search_file':'Search a file...',
    'overlay.filter_ph':  'Filter...',
    'overlay.empty':      'No files in this category',

    // Play panel
    'play_panel.info':    'Information',
    'play_panel.expand':  'Open fullscreen',

    // Instance picker modal
    'inst_pick.title':      'Pick an instance',
    'inst_pick.empty':      'No compatible instance found.',
    'inst_pick.empty_hint': 'Check the MC version and modloader.',
    'inst_pick.install_title': 'Install to an instance',
    'inst_pick.install_where': 'Where do you want to install this {{type}}?',
    'inst_pick.current_instance':'Current instance',
    'inst_pick.incompatible':  'Incompatible',
    'inst_pick.version_unknown':'Unknown version',
    'inst_pick.require_mc':    'MC {{versions}} required',
    'inst_pick.require_loader':'Loader: {{loaders}} required',
    'inst_pick.no_instances':  'No installed instance found. Create or import a modpack first.',
    'inst_pick.type.mod':      'mod',
    'inst_pick.type.shader':   'shader',
    'inst_pick.type.resourcepack': 'resource pack',
    'inst_pick.type.datapack': 'data pack',
    'inst_pick.type.file':     'file',

    // Delete confirm
    'delete.confirm':      'Delete "{{name}}"? This action cannot be undone.',
    'delete.confirm_full': 'Delete "{{name}}"?\nAll files will be removed.',

    // Status
    'status.running': 'Running',
    'status.stopped': 'Stopped',
    'status.online':  'Online',
    'status.offline': 'Offline',
    'status.minecraft_launched': '✓ Minecraft launched (PID {{pid}})',
    'status.kill_sent':          'Stop request sent...',
    'status.stopped_code':       'Stopped (code {{code}})',
    'modal.error_prefix':        '❌',
    'error.generic':             'Error',
    'error.unknown':             'unknown',
    'badge.custom':              'Custom',
    'app.error_no_px':           'ERROR: window.px unavailable.',
    'error.launch_failed':  'Launch failed',
    'error.install_failed': 'Installation failed',
  },
};

// ── Runtime ───────────────────────────────────────────────────────────────────

let _currentLang = 'fr';

function getLang() { return _currentLang; }

function setLang(lang) {
  if (!TRANSLATIONS[lang]) return;
  _currentLang = lang;
  document.getElementById('html-root')?.setAttribute('lang', lang);
  if (window.px?.config) {
    window.px.config.set('settings', Object.assign({}, _cachedSettings, { language: lang }));
  }
  applyTranslations();
}

let _cachedSettings = {};
function setCachedSettings(s) { _cachedSettings = s || {}; }

function t(key, vars = {}) {
  const dict = TRANSLATIONS[_currentLang] || TRANSLATIONS.fr;
  let str = dict[key] ?? TRANSLATIONS.fr[key] ?? key;
  for (const [k, v] of Object.entries(vars)) {
    str = str.replaceAll(`{{${k}}}`, v);
  }
  return str;
}

function applyTranslations() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    el.title = t(el.dataset.i18nTitle);
  });
  document.querySelectorAll('[data-i18n-html]').forEach(el => {
    el.innerHTML = t(el.dataset.i18nHtml);
    // Re-attach cf-link listener if present after innerHTML update
    const cfLink = el.querySelector('#cf-link');
    if (cfLink) {
      cfLink.addEventListener('click', e => {
        e.preventDefault();
        window.px?.shell?.openExternal?.('https://console.curseforge.com');
      });
    }
  });
  // Update <option> elements (data-i18n works on them too via textContent)
  document.querySelectorAll('option[data-i18n]').forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });
}

async function initI18n(cfg) {
  setCachedSettings(cfg);
  const saved = cfg?.language;
  if (saved && TRANSLATIONS[saved]) _currentLang = saved;
  document.getElementById('html-root')?.setAttribute('lang', _currentLang);
  applyTranslations();
}

window.i18n = {
  t,
  getLang,
  setLang,
  initI18n,
  setCachedSettings,
  applyTranslations,
  SUPPORTED_LANGS: Object.keys(TRANSLATIONS),
};
