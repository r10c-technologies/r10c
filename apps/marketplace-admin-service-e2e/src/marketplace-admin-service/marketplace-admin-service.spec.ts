import axios from 'axios';

describe('marketplace-admin-service', () => {
  it('GET /api/health reports ok', async () => {
    const res = await axios.get(`/api/health`);

    expect(res.status).toBe(200);
    expect(res.data).toEqual({
      status: 'ok',
      service: '@r10c/marketplace-admin-service',
    });
  });

  it('GET /api/product returns a paginated page', async () => {
    const res = await axios.get(`/api/product`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.data.items)).toBe(true);
    expect(typeof res.data.total).toBe('number');
  });
});
