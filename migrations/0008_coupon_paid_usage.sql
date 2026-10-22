-- Los pedidos abandonados ya no consumen cupones. Los reembolsados conservan
-- su uso histórico para no permitir reutilizar un descuento tras devolverlo.
UPDATE coupons c SET used_count = (
  SELECT count(*) FROM orders o
  WHERE upper(o.coupon_code) = upper(c.code) AND o.paid_at IS NOT NULL
), updated_at = NOW();
