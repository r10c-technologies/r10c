import { describe, expect, it } from 'vitest';

import { whatsappChatUrl } from './whatsapp-chat.js';

describe('whatsappChatUrl', () => {
  it('opens a chat on the number with the text typed', () => {
    expect(whatsappChatUrl('+50255551234', 'Pedido 7KQ4 & más')).toBe(
      'https://wa.me/50255551234?text=Pedido%207KQ4%20%26%20m%C3%A1s',
    );
    expect(whatsappChatUrl('5555-1234', 'Hola')).toBe(
      'https://wa.me/50255551234?text=Hola',
    );
  });

  it('offers no link for a number it cannot dial', () => {
    expect(whatsappChatUrl(undefined, 'Hola')).toBeUndefined();
    expect(whatsappChatUrl('', 'Hola')).toBeUndefined();
    expect(whatsappChatUrl('123', 'Hola')).toBeUndefined();
  });
});
