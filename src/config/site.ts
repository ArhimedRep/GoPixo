// Замените значения на свои. Пока стоят заглушки, при сборке будет предупреждение.
export const site = {
  brand: 'GoPixo',
  email: 'gopixo.support@gmail.com',
  telegram: 'GoPixoSupport', // без @
};

export const hasPlaceholders = site.email.endsWith('@example.com') || site.telegram === 'your_telegram';
