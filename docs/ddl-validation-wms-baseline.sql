-- =============================================================
-- WMS BASELINE — VALIDASI DDL (regresi skema + invarian perilaku)
-- Jalankan di DB kosong SETELAH schema-wms-baseline.sql + seed-wms-baseline.sql:
--   psql -d <db> -f ddl-validation-wms-baseline.sql
-- Semua dalam satu transaksi & di-ROLLBACK di akhir (tidak mengubah data). Hasil: tabel PASS/FAIL.
-- Aman dijalankan di DB berisi data (mis. instalasi klien): fixture berprefiks VAL-/val_ & setiap pernyataan
-- dibatasi ke fixture. PENGECUALIAN: rekonsiliasi D-2/D-2b sengaja memeriksa SELURUH data (cek integritas nyata).
-- Memuat query acuan invarian D-2/D-2b (behavioral) — dipakai ulang oleh job integritas nightly.
-- Mencakup objek schema v1.6. Terakhir lulus: PostgreSQL 14 (Testcontainers), 2026-09-25.
-- =============================================================
\set ON_ERROR_STOP 1
BEGIN;

CREATE TEMP TABLE result(id text, ok boolean, note text);

-- helper: jalankan SQL, harapkan error dengan SQLSTATE tertentu (NULL = sukses diharapkan)
CREATE FUNCTION pg_temp.expect(tid text, stmt text, want text) RETURNS void AS $$
DECLARE got text := NULL; msg text := '';
BEGIN
  BEGIN
    EXECUTE stmt;
  EXCEPTION WHEN OTHERS THEN got := SQLSTATE; msg := SQLERRM;
  END;
  INSERT INTO result VALUES (tid, got IS NOT DISTINCT FROM want,
    format('want=%s got=%s %s', coalesce(want,'OK'), coalesce(got,'OK'), msg));
END $$ LANGUAGE plpgsql;
-- catatan: kegagalan di dalam EXECUTE ter-rollback ke subtransaksi blok BEGIN/EXCEPTION.

-- ---------- fixture ----------
CREATE TEMP TABLE fx AS
SELECT
  (SELECT id FROM app_user WHERE username='admin')                         AS admin,
  (SELECT id FROM warehouse WHERE code='WH-MAIN')                          AS wh,
  (SELECT id FROM uom WHERE name='Pcs')                                    AS pcs,
  (SELECT id FROM location WHERE code='A-01-01-01' AND warehouse_id IS NOT NULL) AS bin1,
  (SELECT id FROM location WHERE code='A-01-01-02' AND warehouse_id IS NOT NULL) AS bin2,
  (SELECT id FROM location WHERE code='VIRT-SUPPLIER')                     AS vsup,
  (SELECT id FROM location WHERE code='VIRT-CUSTOMER')                     AS vcus,
  (SELECT id FROM operation_type WHERE code='RCV_SUPPLIER')                AS t_rcv,
  (SELECT id FROM operation_type WHERE code='OUT_DELIVERY')                AS t_out,
  (SELECT id FROM operation_type WHERE code='INT_QA_HOLD')                 AS t_qa;

INSERT INTO app_user(username,password_hash,full_name) VALUES ('val_op2','x','Operator 2');
INSERT INTO product(sku,name,base_uom_id,sale_uom_id,use_batch,use_expiry,use_fefo)
  SELECT 'VAL-MED-001','Paracetamol',pcs,pcs,true,true,true FROM fx;
INSERT INTO product_packaging(product_id,uom_id,level_seq,qty_in_base)
  SELECT p.id, fx.pcs, 1, 1 FROM product p, fx WHERE p.sku='VAL-MED-001';
INSERT INTO batch(product_id,batch_no,expiry_date)
  SELECT id,'B1','2027-01-31'::date FROM product WHERE sku='VAL-MED-001'
  UNION ALL SELECT id,'B2','2027-06-30'::date FROM product WHERE sku='VAL-MED-001';
INSERT INTO partner(code,name,type) VALUES ('VAL-CUST-1','Customer 1','CUSTOMER');
INSERT INTO sales_order(erp_ref,partner_id) SELECT 'VAL-SO-1', id FROM partner WHERE code='VAL-CUST-1';
INSERT INTO sales_order_line(so_id,line_no,product_id,qty,erp_qty,erp_uom_id)
  SELECT so.id, n, p.id, q, q, fx.pcs FROM sales_order so, product p, fx,
    (VALUES (1,40),(2,30)) v(n,q) WHERE so.erp_ref='VAL-SO-1' AND p.sku='VAL-MED-001';

-- ---------- E2E-1: receipt 100 (INCOMING confirm) ----------
INSERT INTO operation(operation_type_id,ref_no,status,warehouse_id,created_by)
  SELECT t_rcv,'VAL-RCV-00001','IN_PROGRESS',wh,admin FROM fx;
INSERT INTO operation_line(operation_id,product_id,batch_id,qty,uom_id,qty_base,qty_done_base,to_location_id,status)
  SELECT o.id,p.id,b.id,100,fx.pcs,100,100,fx.bin1,'DONE'
  FROM operation o, product p, batch b, fx WHERE o.ref_no='VAL-RCV-00001' AND p.sku='VAL-MED-001' AND b.batch_no='B1';
INSERT INTO quant(product_id,location_id,batch_id,qty,status)
  SELECT p.id,fx.bin1,b.id,100,'AVAILABLE' FROM product p, batch b, fx WHERE p.sku='VAL-MED-001' AND b.batch_no='B1';
INSERT INTO stock_move(operation_id,product_id,batch_id,from_location_id,to_location_id,from_status,to_status,qty,uom_id,user_id)
  SELECT o.id,p.id,b.id,fx.vsup,fx.bin1,NULL,'AVAILABLE',100,fx.pcs,fx.admin
  FROM operation o, product p, batch b, fx WHERE o.ref_no='VAL-RCV-00001' AND p.sku='VAL-MED-001' AND b.batch_no='B1';
UPDATE operation SET status='DONE', confirmed_at=now() WHERE ref_no='VAL-RCV-00001';

-- ---------- K4: A-1 FOR UPDATE + LEFT JOIN ----------
SELECT pg_temp.expect('K4a FOR UPDATE tanpa OF (harus gagal)',
 $q$SELECT q.id FROM quant q LEFT JOIN batch b ON b.id=q.batch_id WHERE q.status='AVAILABLE' ORDER BY b.expiry_date FOR UPDATE$q$, '0A000');
SELECT pg_temp.expect('K4b FOR UPDATE OF q (A-1 v1.1)',
 $q$SELECT q.id FROM quant q LEFT JOIN batch b ON b.id=q.batch_id WHERE q.status=ANY('{AVAILABLE}'::quant_status[]) ORDER BY b.expiry_date ASC NULLS LAST, q.location_id, q.id FOR UPDATE OF q$q$, NULL);

-- ---------- E2E-2: pick list OUT_DELIVERY, 2 line SKU sama (K2) ----------
INSERT INTO operation(operation_type_id,ref_no,status,warehouse_id,source_doc_type,source_doc_id,created_by)
  SELECT t_out,'VAL-OUT-00001','READY',wh,'SALES_ORDER',(SELECT id FROM sales_order WHERE erp_ref='VAL-SO-1'),admin FROM fx;
INSERT INTO operation_line(operation_id,product_id,qty,uom_id,qty_base,so_line_id)
  SELECT o.id, sl.product_id, sl.qty, fx.pcs, sl.qty, sl.id
  FROM operation o, sales_order_line sl, fx WHERE o.ref_no='VAL-OUT-00001' ORDER BY sl.line_no;

-- A-2 reserve: kurangi quant sumber 70, upsert RESERVED 70, reservasi per line (40 & 30) ke quant RESERVED yang sama
UPDATE quant SET qty = qty - 70 WHERE status='AVAILABLE' AND location_id=(SELECT bin1 FROM fx) AND product_id=(SELECT id FROM product WHERE sku='VAL-MED-001');
INSERT INTO quant(product_id,location_id,batch_id,qty,status)
  SELECT product_id,location_id,batch_id,70,'RESERVED' FROM quant WHERE status='AVAILABLE' AND location_id=(SELECT bin1 FROM fx) AND product_id=(SELECT id FROM product WHERE sku='VAL-MED-001');
INSERT INTO stock_reservation(operation_id,operation_line_id,quant_id,product_id,location_id,batch_id,source_status,qty)
  SELECT l.operation_id, l.id, q.id, q.product_id, q.location_id, q.batch_id, 'AVAILABLE', l.qty_base
  FROM operation_line l JOIN operation o ON o.id=l.operation_id AND o.ref_no='VAL-OUT-00001'
  JOIN quant q ON q.status='RESERVED' AND q.product_id=l.product_id;
UPDATE sales_order_line SET qty_reserved = qty WHERE so_id=(SELECT id FROM sales_order WHERE erp_ref='VAL-SO-1');
INSERT INTO result SELECT 'K2 2 line SKU sama → 2 reservasi pada 1 quant RESERVED', count(*)=2 AND count(DISTINCT quant_id)=1, count(*)::text
  FROM stock_reservation WHERE status='ACTIVE' AND operation_id=(SELECT id FROM operation WHERE ref_no='VAL-OUT-00001');

-- UPSERT pada line yang sama menambah qty (ON CONFLICT partial unique index)
SELECT pg_temp.expect('K2b UPSERT reservasi (line,quant) ON CONFLICT',
 $q$INSERT INTO stock_reservation(operation_id,operation_line_id,quant_id,product_id,location_id,qty)
    SELECT operation_id,operation_line_id,quant_id,product_id,location_id,1 FROM stock_reservation WHERE status='ACTIVE' AND operation_id=(SELECT id FROM operation WHERE ref_no='VAL-OUT-00001') LIMIT 1
    ON CONFLICT (operation_line_id, quant_id) WHERE status='ACTIVE' DO UPDATE SET qty = stock_reservation.qty + 0$q$, NULL);

-- SO over-allocation CHECK (BR-20)
SELECT pg_temp.expect('BR-20 qty_reserved+qty_delivered > qty ditolak',
 $q$UPDATE sales_order_line SET qty_reserved = qty + 1 WHERE line_no=1 AND so_id=(SELECT id FROM sales_order WHERE erp_ref='VAL-SO-1')$q$, '23514');

-- T4 / BR-21: hapus line ber-reservasi ditolak
SELECT pg_temp.expect('T4 hapus line ber-reservasi ditolak (RESTRICT)',
 $q$DELETE FROM operation_line WHERE id=(SELECT operation_line_id FROM stock_reservation WHERE operation_id=(SELECT id FROM operation WHERE ref_no='VAL-OUT-00001') LIMIT 1)$q$, '23503');

-- D-2 saat reservasi ACTIVE (view didefinisikan lebih awal)
CREATE TEMP VIEW v_recon AS
WITH led AS (
  SELECT m.to_location_id loc, m.product_id, m.batch_id, m.to_status st, m.qty FROM stock_move m WHERE m.to_status IS NOT NULL
  UNION ALL
  SELECT m.from_location_id, m.product_id, m.batch_id, m.from_status, -m.qty FROM stock_move m WHERE m.from_status IS NOT NULL
), lsum AS (SELECT loc,product_id,batch_id,st,sum(qty) q FROM led GROUP BY 1,2,3,4),
qsum AS (SELECT loc,product_id,batch_id,st,sum(q) q FROM (
    SELECT location_id loc,product_id,batch_id,status st,qty q FROM quant WHERE status<>'RESERVED'
    UNION ALL  -- quant RESERVED dihitung kembali ke status asal lewat reservasi ACTIVE
    SELECT location_id,product_id,batch_id,source_status,qty FROM stock_reservation WHERE status='ACTIVE') u GROUP BY 1,2,3,4)
SELECT coalesce(l.loc,q.loc) loc, coalesce(l.st,q.st) st, coalesce(l.q,0) ledger, coalesce(q.q,0) quant
FROM lsum l FULL JOIN qsum q USING (loc,product_id,batch_id,st)
JOIN location x ON x.id = coalesce(l.loc,q.loc) AND NOT x.is_system
WHERE coalesce(l.q,0) <> coalesce(q.q,0);
INSERT INTO result SELECT 'D-2a rekonsiliasi saat reservasi ACTIVE (0 selisih)', count(*)=0, count(*)::text||' selisih' FROM v_recon;
CREATE TEMP VIEW v_pool AS
SELECT q.location_id, q.product_id, q.batch_id, q.qty quant_reserved,
       (SELECT coalesce(sum(r.qty),0) FROM stock_reservation r WHERE r.status='ACTIVE' AND r.quant_id=q.id) resv
FROM quant q WHERE q.status='RESERVED';
INSERT INTO result SELECT 'D-2b pool RESERVED = Σ reservasi ACTIVE', bool_and(quant_reserved=resv), string_agg(quant_reserved||'/'||resv, ',') FROM v_pool;
-- ---------- K1: confirm OUTGOING — urutan tulis A-4a v1.1.1 (reservasi CONSUMED dulu, baru quant) ----------
SELECT pg_temp.expect('K1a urutan salah (DELETE quant RESERVED saat reservasi ACTIVE) ditolak',
 $q$DELETE FROM quant WHERE status='RESERVED' AND product_id=(SELECT id FROM product WHERE sku='VAL-MED-001')$q$, '23514');   -- CHECK menjaga urutan tulis

SELECT pg_temp.expect('K1b CONSUMED dulu lalu DELETE quant RESERVED',
 $q$WITH c AS (UPDATE stock_reservation SET status='CONSUMED' WHERE status='ACTIVE' AND operation_id=(SELECT id FROM operation WHERE ref_no='VAL-OUT-00001') RETURNING 1) SELECT count(*) FROM c$q$, NULL);
INSERT INTO stock_move(operation_id,product_id,batch_id,from_location_id,to_location_id,from_status,to_status,qty,uom_id,user_id)
  SELECT r.operation_id,r.product_id,r.batch_id,r.location_id,fx.vcus,r.source_status,NULL,r.qty,fx.pcs,fx.admin
  FROM stock_reservation r, fx WHERE r.status='CONSUMED' AND r.operation_id=(SELECT id FROM operation WHERE ref_no='VAL-OUT-00001');
SELECT pg_temp.expect('K1c DELETE quant RESERVED (qty 0) → reservasi.quant_id SET NULL',
 $q$DELETE FROM quant WHERE status='RESERVED' AND product_id=(SELECT id FROM product WHERE sku='VAL-MED-001')$q$, NULL);
INSERT INTO result SELECT 'K1d reservasi CONSUMED tetap ada, quant_id NULL', bool_and(quant_id IS NULL), count(*)::text
  FROM stock_reservation WHERE status='CONSUMED' AND operation_id=(SELECT id FROM operation WHERE ref_no='VAL-OUT-00001');
UPDATE sales_order_line SET qty_delivered = qty_delivered + qty_reserved, qty_reserved = 0 WHERE so_id=(SELECT id FROM sales_order WHERE erp_ref='VAL-SO-1');
UPDATE operation SET status='DONE', confirmed_at=now() WHERE ref_no='VAL-OUT-00001';

-- ---------- D-8: QA hold in-place (status berubah, lokasi sama) ----------
INSERT INTO operation(operation_type_id,ref_no,status,warehouse_id,created_by)
  SELECT t_qa,'VAL-QAH-00001','DONE',wh,admin FROM fx;
UPDATE quant SET qty=qty-10 WHERE status='AVAILABLE' AND product_id=(SELECT id FROM product WHERE sku='VAL-MED-001');
INSERT INTO quant(product_id,location_id,batch_id,qty,status)
  SELECT product_id,location_id,batch_id,10,'QUARANTINE' FROM quant WHERE status='AVAILABLE' AND product_id=(SELECT id FROM product WHERE sku='VAL-MED-001');
SELECT pg_temp.expect('D-8 stock_move in-place beda status (sah)',
 $q$INSERT INTO stock_move(operation_id,product_id,batch_id,from_location_id,to_location_id,from_status,to_status,qty,uom_id,user_id)
    SELECT o.id,q.product_id,q.batch_id,q.location_id,q.location_id,'AVAILABLE','QUARANTINE',10,(SELECT pcs FROM fx),(SELECT admin FROM fx)
    FROM operation o, quant q WHERE o.ref_no='VAL-QAH-00001' AND q.status='QUARANTINE' AND q.product_id=(SELECT id FROM product WHERE sku='VAL-MED-001')$q$, NULL);
SELECT pg_temp.expect('BR-10 move semu (lokasi & status sama) ditolak',
 $q$INSERT INTO stock_move(operation_id,product_id,from_location_id,to_location_id,from_status,to_status,qty,uom_id,user_id)
    SELECT o.id,p.id,fx.bin1,fx.bin1,'AVAILABLE','AVAILABLE',1,fx.pcs,fx.admin FROM operation o, product p, fx WHERE o.ref_no='VAL-QAH-00001' AND p.sku='VAL-MED-001'$q$, '23514');
SELECT pg_temp.expect('BR-18 stock_move tanpa operation ditolak',
 $q$INSERT INTO stock_move(product_id,from_location_id,to_location_id,qty,uom_id,user_id)
    SELECT p.id,fx.bin1,fx.bin2,1,fx.pcs,fx.admin FROM product p, fx WHERE p.sku='VAL-MED-001'$q$, '23502');
SELECT pg_temp.expect('Lokasi NULL di stock_move ditolak',
 $q$INSERT INTO stock_move(operation_id,product_id,from_location_id,to_location_id,qty,uom_id,user_id)
    SELECT o.id,p.id,NULL,fx.bin2,1,fx.pcs,fx.admin FROM operation o, product p, fx WHERE o.ref_no='VAL-QAH-00001' AND p.sku='VAL-MED-001'$q$, '23502');

-- ---------- D-2: RESERVED tak pernah di ledger / sebagai source_status ----------
SELECT pg_temp.expect('D-2 stock_move from_status=RESERVED ditolak',
 $q$INSERT INTO stock_move(operation_id,product_id,from_location_id,to_location_id,from_status,qty,uom_id,user_id)
    SELECT o.id,p.id,fx.bin1,fx.vcus,'RESERVED',1,fx.pcs,fx.admin FROM operation o, product p, fx WHERE o.ref_no='VAL-QAH-00001' AND p.sku='VAL-MED-001'$q$, '23514');
SELECT pg_temp.expect('D-2 reservasi source_status=RESERVED ditolak',
 $q$UPDATE stock_reservation SET source_status='RESERVED' WHERE operation_id=(SELECT id FROM operation WHERE ref_no='VAL-OUT-00001')$q$, '23514');

-- ---------- D-2c: rekonsiliasi akhir ----------

-- catatan: reserve (A-2) tidak menulis ledger → RESERVED dihitung kembali ke source_status via reservasi ACTIVE (di sini 0 karena sudah dikonsumsi)
INSERT INTO result SELECT 'D-2c rekonsiliasi setelah confirm + QA in-place (0 selisih)', count(*)=0, count(*)::text||' selisih' FROM v_recon;

-- ---------- K3 / BR-22: hapus user ber-histori ----------
SELECT pg_temp.expect('K3 DELETE user dirujuk stock_move → FK RESTRICT (bukan error trigger)',
 $q$DELETE FROM app_user WHERE username='admin'$q$, '23503');
SELECT pg_temp.expect('K3b soft-delete (status INACTIVE)',
 $q$UPDATE app_user SET status='INACTIVE' WHERE username='val_op2'$q$, NULL);

-- ---------- BR-4: immutabilitas ----------
SELECT pg_temp.expect('BR-4 UPDATE stock_move ditolak trigger', $q$UPDATE stock_move SET qty=qty$q$, 'P0001');
SELECT pg_temp.expect('BR-4 DELETE stock_move ditolak trigger', $q$DELETE FROM stock_move$q$, 'P0001');
INSERT INTO audit_log(entity,action) VALUES ('test','CREATE');
SELECT pg_temp.expect('BR-4 UPDATE audit_log ditolak trigger', $q$UPDATE audit_log SET action='X'$q$, 'P0001');

-- ---------- BR-19: anti self-approval ----------
SELECT pg_temp.expect('BR-19 approved_by = created_by ditolak',
 $q$UPDATE operation SET approved_by=created_by WHERE ref_no='VAL-QAH-00001'$q$, '23514');
SELECT pg_temp.expect('BR-19 approver lain diterima',
 $q$UPDATE operation SET approved_by=(SELECT id FROM app_user WHERE username='val_op2') WHERE ref_no='VAL-QAH-00001'$q$, NULL);

-- ---------- Integritas lain ----------
SELECT pg_temp.expect('optype require_approval tanpa approve_menu ditolak',
 $q$INSERT INTO operation_type(code,name,direction,require_approval,menu_code) VALUES ('VAL-X1','x','OUTGOING',true,'outbound_scrap')$q$, '23514');
SELECT pg_temp.expect('optype menu_code tak terdaftar ditolak (FK)',
 $q$INSERT INTO operation_type(code,name,direction,menu_code) VALUES ('VAL-X2','x','OUTGOING','tidak_ada')$q$, '23503');
SELECT pg_temp.expect('operation tanpa warehouse ditolak',
 $q$INSERT INTO operation(operation_type_id,ref_no) SELECT t_out,'VAL-X-1' FROM fx$q$, '23502');
SELECT pg_temp.expect('uq_quant_combo: kombinasi sama (batch NULL) ditolak',
 $q$INSERT INTO quant(product_id,location_id,qty) SELECT p.id,fx.bin2,1 FROM product p, fx;
    INSERT INTO quant(product_id,location_id,qty) SELECT p.id,fx.bin2,1 FROM product p, fx$q$, '23505');
SELECT pg_temp.expect('quant qty negatif ditolak', $q$UPDATE quant SET qty=-1 WHERE product_id=(SELECT id FROM product WHERE sku='VAL-MED-001')$q$, '23514');
SELECT pg_temp.expect('reservasi ACTIVE tanpa quant ditolak',
 $q$INSERT INTO stock_reservation(operation_id,operation_line_id,product_id,location_id,qty)
    SELECT operation_id,id,product_id,(SELECT bin1 FROM fx),1 FROM operation_line LIMIT 1$q$, '23514');
SELECT pg_temp.expect('line: qty_done_base > qty_base ditolak',
 $q$UPDATE operation_line SET qty_done_base = qty_base + 1 WHERE operation_id=(SELECT id FROM operation WHERE ref_no='VAL-OUT-00001')$q$, '23514');
SELECT pg_temp.expect('line: so_line & po_line sekaligus ditolak',
 $q$UPDATE operation_line SET po_line_id = gen_random_uuid() WHERE so_line_id IS NOT NULL AND operation_id=(SELECT id FROM operation WHERE ref_no='VAL-OUT-00001')$q$, '23514');

-- A-7 doc_counter
SELECT pg_temp.expect('A-7 doc_counter upsert',
 $q$INSERT INTO doc_counter(scope_key,last_seq) VALUES('VAL:SEQ',1) ON CONFLICT (scope_key) DO UPDATE SET last_seq=doc_counter.last_seq+1;
    INSERT INTO doc_counter(scope_key,last_seq) VALUES('VAL:SEQ',1) ON CONFLICT (scope_key) DO UPDATE SET last_seq=doc_counter.last_seq+1$q$, NULL);
INSERT INTO result SELECT 'A-7 sekuens = 2', last_seq=2, last_seq::text FROM doc_counter WHERE scope_key='VAL:SEQ';

-- A-5 advisory lock expression
SELECT pg_temp.expect('A-5 pg_advisory_xact_lock(hashtext(product))',
 $q$SELECT pg_advisory_xact_lock(hashtext('p:'||id::text)) FROM product ORDER BY id$q$, NULL);

-- version bump trigger
INSERT INTO result SELECT 'operation.version naik via trigger', version>0, version::text FROM operation WHERE ref_no='VAL-OUT-00001';

-- ---------- v1.5: state mesin langkah (flow-steps §5) ----------
SELECT pg_temp.expect('v1.5 barcode GTIN unik per level',
 $q$UPDATE product_packaging SET barcode='VAL-GTIN-0001' WHERE level_seq=1 AND product_id=(SELECT id FROM product WHERE sku='VAL-MED-001');
    INSERT INTO product_packaging(product_id,uom_id,level_seq,qty_in_base,barcode)
    SELECT product_id,(SELECT id FROM uom WHERE name='Carton'),3,100,'VAL-GTIN-0001' FROM product_packaging WHERE level_seq=1 AND product_id=(SELECT id FROM product WHERE sku='VAL-MED-001')$q$, '23505');
SELECT pg_temp.expect('v1.5 cursor valid (bin SOURCE + produk menunggu qty)',
 $q$INSERT INTO operation_cursor(operation_id,line_id,bin_location_id,bin_role,pending_product_id,pending_uom_id,updated_by)
    SELECT o.id,(SELECT id FROM operation_line WHERE operation_id=o.id LIMIT 1),fx.bin1,'SOURCE',p.id,fx.pcs,fx.admin
    FROM operation o, product p, fx WHERE o.ref_no='VAL-OUT-00001' AND p.sku='VAL-MED-001'$q$, NULL);
SELECT pg_temp.expect('v1.5 cursor bin_role tak dikenal ditolak',
 $q$UPDATE operation_cursor SET bin_role='MIDDLE' WHERE operation_id=(SELECT id FROM operation WHERE ref_no='VAL-OUT-00001')$q$, '23514');
SELECT pg_temp.expect('v1.5 cursor bin tanpa peran ditolak',
 $q$UPDATE operation_cursor SET bin_role=NULL WHERE operation_id=(SELECT id FROM operation WHERE ref_no='VAL-OUT-00001')$q$, '23514');
SELECT pg_temp.expect('v1.5 cursor produk tanpa UOM ditolak',
 $q$UPDATE operation_cursor SET pending_uom_id=NULL WHERE operation_id=(SELECT id FROM operation WHERE ref_no='VAL-OUT-00001')$q$, '23514');
SELECT pg_temp.expect('v1.5 staging_location_id harus lokasi valid (FK)',
 $q$UPDATE operation SET staging_location_id=gen_random_uuid() WHERE ref_no='VAL-OUT-00001'$q$, '23503');
SELECT pg_temp.expect('v1.5 staging/dock & label_printed_at terisi',
 $q$UPDATE operation SET staging_location_id=(SELECT id FROM location WHERE code='STAGE-01'),
                         dock_location_id=(SELECT id FROM location WHERE code='DOCK-01') WHERE ref_no='VAL-OUT-00001';
    UPDATE handling_unit SET label_printed_at=now() WHERE code LIKE 'VAL-%'$q$, NULL);

-- ---------- v1.6: progres scan per reservasi (D-18) ----------
SELECT pg_temp.expect('v1.6 reservasi qty_done > qty ditolak',
 $q$UPDATE stock_reservation SET qty_done = qty + 1 WHERE operation_id=(SELECT id FROM operation WHERE ref_no='VAL-OUT-00001')$q$, '23514');
SELECT pg_temp.expect('v1.6 reservasi qty_done negatif ditolak',
 $q$UPDATE stock_reservation SET qty_done = -1 WHERE operation_id=(SELECT id FROM operation WHERE ref_no='VAL-OUT-00001')$q$, '23514');
SELECT pg_temp.expect('v1.6 reservasi qty_done = qty diterima',
 $q$UPDATE stock_reservation SET qty_done = qty WHERE operation_id=(SELECT id FROM operation WHERE ref_no='VAL-OUT-00001')$q$, NULL);

\pset format aligned
SELECT CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS hasil, id AS skenario, note FROM result ORDER BY ok, id;
SELECT count(*) FILTER (WHERE ok) pass, count(*) FILTER (WHERE NOT ok) fail FROM result;
ROLLBACK;
