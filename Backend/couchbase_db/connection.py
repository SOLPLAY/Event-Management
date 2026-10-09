import os
from datetime import timedelta
from functools import lru_cache

from dotenv import load_dotenv
from couchbase.auth import PasswordAuthenticator
from couchbase.cluster import Cluster
from couchbase.options import ClusterOptions

load_dotenv()


@lru_cache(maxsize=1)
def get_cluster():
    endpoint = os.getenv("COUCHBASE_CONNECTION_STRING")
    username = os.getenv("COUCHBASE_USERNAME")
    password = os.getenv("COUCHBASE_PASSWORD")

    if not endpoint or not username or not password:
        raise RuntimeError(
            "Missing COUCHBASE_CONNECTION_STRING, "
            "COUCHBASE_USERNAME, or COUCHBASE_PASSWORD in .env"
        )

    auth = PasswordAuthenticator(username, password)
    options = ClusterOptions(auth)
    options.apply_profile("wan_development")

    cluster = Cluster.connect(endpoint, options)

    try:
        cluster.wait_until_ready(timedelta(seconds=15))
    except Exception:
        cluster.close()
        raise

    return cluster


@lru_cache(maxsize=1)
def get_collection():
    bucket_name = os.getenv("COUCHBASE_BUCKET")
    scope_name = os.getenv("COUCHBASE_SCOPE")
    collection_name = os.getenv("COUCHBASE_COLLECTION")

    if not all([bucket_name, scope_name, collection_name]):
        raise RuntimeError(
            "Missing COUCHBASE_BUCKET, COUCHBASE_SCOPE, "
            "or COUCHBASE_COLLECTION in .env"
        )

    bucket = get_cluster().bucket(bucket_name)
    scope = bucket.scope(scope_name)
    return scope.collection(collection_name)
