-- Existing categories stay at the root; product assignments are preserved.
ALTER TABLE categories ADD COLUMN parent_id uuid REFERENCES categories(id) ON DELETE RESTRICT;
ALTER TABLE categories ADD CONSTRAINT categories_not_self_parent CHECK (parent_id IS DISTINCT FROM id);
CREATE INDEX categories_parent_idx ON categories(parent_id);

-- Do not silently orphan products when deleting a category.
ALTER TABLE products DROP CONSTRAINT products_category_id_fkey;
ALTER TABLE products ADD CONSTRAINT products_category_id_fkey
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE RESTRICT;

-- Serialize hierarchy changes, including concurrent opposite reparenting.
CREATE FUNCTION lock_category_hierarchy() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(604932715);
  RETURN NULL;
END;
$$;
CREATE TRIGGER category_hierarchy_lock BEFORE INSERT OR UPDATE OR DELETE ON categories
  FOR EACH STATEMENT EXECUTE FUNCTION lock_category_hierarchy();

CREATE FUNCTION validate_category_hierarchy() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.parent_id IS NOT NULL THEN
    IF NEW.parent_id = NEW.id
       OR EXISTS (SELECT 1 FROM categories WHERE id = NEW.parent_id AND parent_id IS NOT NULL)
       OR EXISTS (SELECT 1 FROM categories WHERE parent_id = NEW.id) THEN
      RAISE EXCEPTION 'Solo se permiten categorías y un nivel de subcategorías.'
        USING ERRCODE = '23514', CONSTRAINT = 'categories_two_levels';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER category_hierarchy_validate BEFORE INSERT OR UPDATE OF parent_id ON categories
  FOR EACH ROW EXECUTE FUNCTION validate_category_hierarchy();
