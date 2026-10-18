export const site = {
  brand: 'GoPixo',
  email: 'gopixo.support@gmail.com',
  telegram: 'GoPixoSupport', // без @
};

// Сведения об исполнителе для юридических документов. Заполните своими данными:
// пока поле пустое, в документах оно подсвечивается как «[…]», а при сборке выводится предупреждение.
export const legal = {
  status: '' as '' | 'npd' | 'ip', // 'npd' — самозанятый, 'ip' — индивидуальный предприниматель
  fullName: '', // например: 'Иванов Иван Иванович'
  inn: '',
  ogrnip: '', // только для ИП
  address: '', // для ИП: адрес места нахождения (регистрации)
  updated: '18 октября 2026 г.', // дата редакции документов; меняйте при правках
};

export const legalMissing = (): string[] => {
  const miss: string[] = [];
  if (!legal.status) miss.push('status');
  if (!legal.fullName) miss.push('fullName');
  if (!legal.inn) miss.push('inn');
  if (legal.status === 'ip' && !legal.ogrnip) miss.push('ogrnip');
  if (legal.status === 'ip' && !legal.address) miss.push('address');
  return miss;
};

export const executorLine = (): string => {
  if (!legal.fullName) return '';
  const parts = [legal.status === 'ip' ? `ИП ${legal.fullName}` : legal.status === 'npd' ? `${legal.fullName}, самозанятый` : legal.fullName];
  if (legal.inn) parts.push(`ИНН ${legal.inn}`);
  if (legal.status === 'ip' && legal.ogrnip) parts.push(`ОГРНИП ${legal.ogrnip}`);
  return parts.join(', ');
};

export const hasPlaceholders = site.email.endsWith('@example.com') || site.telegram === 'your_telegram';
