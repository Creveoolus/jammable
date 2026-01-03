import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

const resources = {
  en: {
    translation: {
      "welcome": "Welcome to Jamable 🎵",
      "description": "Collect all your desired music in one app. Realtime synchronization with friends.",
      "create_room": "Create Room",
      "join_room": "Join Room",
      "nickname": "Nickname",
      "password": "Password (Optional)",
      "room_id": "Room ID",
      "enter_link": "Paste link here (YouTube, SoundCloud, etc.)",
      "add_to_queue": "Add to Queue",
      "admin_controls": "Admin Controls",
      "kick": "Kick",
      "users": "Users",
      "queue": "Queue",
      "empty_queue": "Queue is empty. Add some tracks! 🎶",
      "playing": "Now Playing",
      "paused": "Paused",
      "language": "Language"
    }
  },
  ru: {
    translation: {
      "welcome": "Добро пожаловать в Jamable 🎵",
      "description": "Соберите всю желаемую музыку в одном приложении. Синхронизация в реальном времени.",
      "create_room": "Создать комнату",
      "join_room": "Присоединиться",
      "nickname": "Никнейм",
      "password": "Пароль (опционально)",
      "room_id": "ID Комнаты",
      "enter_link": "Вставьте ссылку (YouTube, SoundCloud и т.д.)",
      "add_to_queue": "Добавить",
      "admin_controls": "Управление админа",
      "kick": "Выгнать",
      "users": "Пользователи",
      "queue": "Очередь",
      "empty_queue": "Очередь пуста. Добавьте треки! 🎶",
      "playing": "Сейчас играет",
      "paused": "На паузе",
      "language": "Язык"
    }
  },
  de: {
    translation: {
      "welcome": "Willkommen bei Jamable 🎵",
      "description": "Sammle all deine gewünschte Musik in einer App. Echtzeit-Synchronisation mit Freunden.",
      "create_room": "Raum erstellen",
      "join_room": "Raum beitreten",
      "nickname": "Spitzname",
      "password": "Passwort (Optional)",
      "room_id": "Raum ID",
      "enter_link": "Link hier einfügen...",
      "add_to_queue": "Hinzufügen",
      "admin_controls": "Admin-Steuerung",
      "kick": "Rauswerfen",
      "users": "Benutzer",
      "queue": "Warteschlange",
      "empty_queue": "Warteschlange ist leer. Füge Titel hinzu! 🎶",
      "playing": "Läuft gerade",
      "paused": "Pausiert",
      "language": "Sprache"
    }
  }
};

i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: localStorage.getItem('jamable_language') || "en", 
    fallbackLng: "en",
    interpolation: {
      escapeValue: false 
    }
  });

export default i18n;
